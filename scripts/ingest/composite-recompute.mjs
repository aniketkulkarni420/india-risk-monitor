// Composite re-derivation at bundle time · v2 · 2026-05-12
//
// CHANGES vs v1 (post devil's-advocate audit):
//   1. Status-bucket avg replaced with z-score against rolling sparkline_12m
//   2. Missing-data penalty · driver returns null + state:'insufficient_data'
//      when >30% of feeders are stale or absent
//   3. Correlation-adjusted weights · discount overlapping macro/flows/oil signal
//   4. Triple-jeopardy flag · fires when oil + INR + FII simultaneously >= 65
//   5. Regime score (EWMA over sparkline_12m) + shock indicator (point-move vs 30d baseline)
//   6. Manual composite override · honors data/manual-overrides/{driver_id}.json
//   7. Reference events embedded on india_risk_score output (2008/2013/2020/2022/2024)
//   8. Status-to-score retained ONLY as final fallback when sparkline missing
//
// All STATUS_TO_SCORE buckets retained for parsers that emit status without
// numeric history. Z-score path used whenever sparkline_12m has >=6 points.

import { lookupOverride } from './manual-override.mjs';

const STATUS_TO_SCORE = { shock: 92, high: 75, med: 55, low: 30, neutral: 50 };

const STALENESS_DAYS = 7;
const MISSING_DATA_THRESHOLD = 0.30;  // fail driver if >30% feeders stale/absent

// EWMA smoothing factor for regime score
const EWMA_ALPHA = 0.3;

// Shock indicator threshold (point move from 30d baseline)
const SHOCK_POINT_MOVE = 8;

// Triple-jeopardy thresholds
const TRIPLE_JEOPARDY = {
  driver_oil_physical: 65,
  driver_india_macro: 65,
  driver_institutional_flows: 65
};

// Correlation-adjusted weight matrix.
// Literature-default ρ between drivers (qualitative, calibratable via backtest).
// When two drivers are highly correlated, their effective combined weight is
// reduced to avoid double-counting one underlying risk factor.
// Pairs not listed default to ρ=0 (independent).
const RHO = {
  'driver_oil_physical:driver_india_macro': 0.55,        // Oil → INR weakness
  'driver_oil_physical:driver_institutional_flows': 0.40, // Oil shock → FII selling
  'driver_oil_physical:driver_freight': 0.50,            // Oil → freight rates
  'driver_india_macro:driver_institutional_flows': 0.45, // Macro stress → FII outflows
  'driver_india_macro:driver_real_economy': 0.35,        // Macro deterioration → consumption
  'driver_institutional_flows:driver_sector_breadth': 0.45 // FII selling → breadth narrows
};

// Historical reference events · v2-calibrated point estimates.
// These are what the v2 scoring engine produces when fed synthetic
// feeders matching each event's known macro state (see scripts/backtest-composites.mjs).
// Will be replaced with real-history-driven values once multi-year feeder
// archives are available (FRED / dbnomics / TradingEconomics archive pulls).
// Framework limitation: scores reflect India-as-oil-importer risk;
// oil-price-collapse events (2020 COVID) read lower than peak crisis level.
const REFERENCE_EVENTS = [
  { date: '2008-10-15', label: 'Lehman / GFC peak',         est_score: 70, note: 'All drivers elevated; correlation adjustment dampens combined effect' },
  { date: '2013-08-28', label: 'Taper tantrum INR low',     est_score: 63, note: 'Macro + flows shock; oil neutral' },
  { date: '2020-03-23', label: 'COVID lockdown',            est_score: 60, note: 'Real-economy collapse but oil-low offsets; demand shock vs price shock' },
  { date: '2022-03-08', label: 'Russia-Ukraine oil shock',  est_score: 67, note: 'Classic oil-importer scenario; framework calibrated for this' },
  { date: '2024-06-04', label: 'Election results day',      est_score: 49, note: 'Single-day FII outflow; broader macro stable' }
];

// ──────────────────────────────────────────────────────────────────────
// Feeder-level normalization
// ──────────────────────────────────────────────────────────────────────

function rho(a, b) {
  return RHO[`${a}:${b}`] ?? RHO[`${b}:${a}`] ?? 0;
}

function statusScore(metric) {
  if (!metric) return null;  // changed from 50 — null signals "missing"
  return STATUS_TO_SCORE[metric.status] ?? 50;
}

/**
 * Normalize a feeder metric to 0-100 using z-score against its sparkline_12m.
 * Returns null if sparkline has <6 numeric points.
 *
 * Mapping: z=0 → 50, z=+2 → 90, z=-2 → 10. Linear clip at 0/100.
 * For inverse metrics (e.g. hormuz_throughput where LOW = high risk),
 * caller passes inverse=true.
 */
function zScoreToRiskScore(metric, { inverse = false } = {}) {
  if (!metric || typeof metric.value !== 'number') return null;
  const spark = Array.isArray(metric.sparkline_12m) ? metric.sparkline_12m : [];
  const nums = spark.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 6) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 50;
  const z = (metric.value - mean) / stddev;
  const directedZ = inverse ? -z : z;
  const score = 50 + directedZ * 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Metrics where LOW raw value = HIGH risk. Used in z-score path.
//
// IMPORTANT sign convention notes:
// - inr_usd: NOT inverse. High value = weak rupee = high risk for India.
// - brent_crude: NOT inverse. High value = high import bill = high risk.
//   (Framework calibrated for India-as-oil-importer; low oil reads as LOW risk
//    even during demand-shock events like COVID. Documented limitation.)
// - FII/DII flows: inverse. High inflow value = low risk.
const INVERSE_FEEDERS = new Set([
  'hormuz_throughput', 'absorption_ratio', 'fx_reserves',
  'gst_gross', 'pmi_combined', 'iip_growth', 'auto_2w', 'auto_pv', 'auto_cv',
  'eway_bills', 'upi_value', 'fastag_toll', 'rail_freight', 'pol_demand',
  'steel_consumption', 'power_demand', 'fpi_debt_flows',
  'fii_equity_daily', 'fii_equity_mtd', 'dii_daily', 'dii_mtd'
]);

function feederScore(metric) {
  if (!metric) return { score: null, source: 'missing' };
  const inverse = INVERSE_FEEDERS.has(metric.metric_id);
  const z = zScoreToRiskScore(metric, { inverse });
  if (z !== null) return { score: z, source: 'zscore' };
  const s = statusScore(metric);
  if (s !== null) return { score: s, source: 'status_fallback' };
  return { score: null, source: 'no_data' };
}

// ──────────────────────────────────────────────────────────────────────
// Feeder health & missing-data penalty
// ──────────────────────────────────────────────────────────────────────

function feederHealth(metrics, ids) {
  const now = Date.now();
  let total = 0, fresh = 0, stale = 0, missing = 0;
  for (const id of ids) {
    total++;
    const m = metrics.get(id);
    if (!m) { missing++; continue; }
    const lv = m.last_verified_at;
    if (!lv) { stale++; continue; }
    const ageDays = (now - new Date(lv).getTime()) / 86400000;
    if (ageDays > STALENESS_DAYS) stale++; else fresh++;
  }
  return {
    total,
    fresh, stale, missing,
    fresh_pct: total ? +(100 * fresh / total).toFixed(1) : 0,
    missing_pct: total ? +(100 * (stale + missing) / total).toFixed(1) : 100
  };
}

// ──────────────────────────────────────────────────────────────────────
// Driver score · z-score weighted + missing-data penalty
// ──────────────────────────────────────────────────────────────────────

function driverScore(metrics, ids, weights) {
  let sum = 0, w = 0;
  const usedFeeders = [];
  const missingFeeders = [];
  for (let i = 0; i < ids.length; i++) {
    const m = metrics.get(ids[i]);
    const { score, source } = feederScore(m);
    if (score === null) { missingFeeders.push(ids[i]); continue; }
    const wt = weights ? weights[i] : 1;
    sum += score * wt;
    w += wt;
    usedFeeders.push({ id: ids[i], score, source, weight: wt });
  }
  if (w === 0) return { value: null, reason: 'no_feeders', usedFeeders, missingFeeders };
  return { value: Math.round(sum / w), reason: 'ok', usedFeeders, missingFeeders };
}

// ──────────────────────────────────────────────────────────────────────
// Regime + shock split
// ──────────────────────────────────────────────────────────────────────

function ewma(values, alpha = EWMA_ALPHA) {
  if (!values.length) return null;
  let s = values[0];
  for (let i = 1; i < values.length; i++) s = alpha * values[i] + (1 - alpha) * s;
  return Math.round(s);
}

function regimeAndShock(metric) {
  const spark = Array.isArray(metric.sparkline_12m) ? metric.sparkline_12m : [];
  const nums = spark.filter(v => typeof v === 'number' && Number.isFinite(v));
  const regime = nums.length >= 3 ? ewma(nums) : (typeof metric.value === 'number' ? metric.value : null);
  const baseline = typeof metric.baseline_30d === 'number' ? metric.baseline_30d : regime;
  const pointMove = typeof metric.value === 'number' && typeof baseline === 'number'
    ? metric.value - baseline : 0;
  const shockActive = Math.abs(pointMove) >= SHOCK_POINT_MOVE;
  return {
    regime_score: regime,
    point_move_30d: typeof pointMove === 'number' ? +pointMove.toFixed(1) : 0,
    shock_indicator: shockActive,
    shock_direction: shockActive ? (pointMove > 0 ? 'up' : 'down') : null
  };
}

// ──────────────────────────────────────────────────────────────────────
// Correlation-adjusted top-level aggregation
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute india_risk_score as a correlation-adjusted weighted average.
 * For each pair of drivers (i, j) with correlation ρ_ij > 0, we reduce
 * the effective combined weight by w_i * w_j * ρ_ij. This prevents
 * double-counting when oil-shock simultaneously elevates oil + macro + flows.
 *
 * Equivalent formula:
 *   raw_score = Σ w_i * v_i / Σ w_i
 *   adjustment = Σ_{i<j} w_i w_j ρ_ij (v_i + v_j - 100) / (Σ w_i)^2
 *   final = raw_score - adjustment
 *
 * Adjustment is bounded; negative scores clipped to 0.
 */
function correlationAdjusted(drivers, weights) {
  // drivers: array of {id, value, weight}, may include nulls (filtered here)
  const valid = drivers.filter(d => typeof d.value === 'number');
  if (!valid.length) return { value: null, raw: null, adjustment: 0 };

  const totalW = valid.reduce((a, d) => a + d.weight, 0);
  const raw = valid.reduce((a, d) => a + d.value * d.weight, 0) / totalW;

  let adjustment = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const r = rho(valid[i].id, valid[j].id);
      if (r === 0) continue;
      // Discount only when both drivers are elevated (above 50)
      const overlap = Math.max(0, valid[i].value - 50) * Math.max(0, valid[j].value - 50);
      adjustment += (valid[i].weight * valid[j].weight * r * overlap) / (totalW * totalW * 10);
    }
  }
  const final = Math.max(0, Math.min(100, Math.round(raw - adjustment)));
  return { value: final, raw: Math.round(raw), adjustment: +adjustment.toFixed(1) };
}

// ──────────────────────────────────────────────────────────────────────
// Triple jeopardy
// ──────────────────────────────────────────────────────────────────────

function checkTripleJeopardy(metrics) {
  const hits = {};
  let count = 0;
  for (const [id, threshold] of Object.entries(TRIPLE_JEOPARDY)) {
    const m = metrics.get(id);
    const elevated = m && typeof m.value === 'number' && m.value >= threshold;
    hits[id] = { value: m?.value ?? null, threshold, elevated: !!elevated };
    if (elevated) count++;
  }
  return {
    active: count === Object.keys(TRIPLE_JEOPARDY).length,
    drivers_elevated: count,
    drivers_required: Object.keys(TRIPLE_JEOPARDY).length,
    detail: hits
  };
}

// ──────────────────────────────────────────────────────────────────────
// Manual override path
// ──────────────────────────────────────────────────────────────────────

function applyManualOverride(metric) {
  if (!metric) return false;
  try {
    const o = lookupOverride(metric.metric_id);
    if (o && o.ok) {
      metric._composite_was = metric.value;
      metric.value = o.value;
      metric.manual_override = {
        active: true,
        source_url: o.source_url,
        source_name: o.source_name,
        note: o.note,
        as_of: o.as_of,
        expires_at: o.expires_at
      };
      return true;
    }
  } catch {}
  return false;
}

// ──────────────────────────────────────────────────────────────────────
// Driver definitions
// ──────────────────────────────────────────────────────────────────────

const DRIVER_DEFS = [
  { id: 'driver_oil_physical',        ids: ['brent_crude','india_crude_basket','hormuz_throughput','vlcc_tanker_rates'], weights: [3,2,3,2] },
  { id: 'driver_freight',             ids: ['drewry_wci','baltic_dry_index','vlcc_tanker_rates','india_port_dwell_time'], weights: [3,2,3,2] },
  { id: 'driver_institutional_flows', ids: ['fii_equity_daily','fii_equity_mtd','dii_daily','dii_mtd','absorption_ratio'], weights: [2,2,2,2,3] },
  { id: 'driver_india_macro',         ids: ['inr_usd','cpi_inflation','wpi_inflation','iip_growth','fiscal_deficit_pct','cad_pct_gdp'], weights: [3,3,2,2,2,2] },
  { id: 'driver_real_economy',        ids: ['gst_gross','pmi_combined','iip_growth','steel_consumption','auto_2w','rail_freight'], weights: [3,2,2,2,2,2] }
];

const RISK_DRIVERS = ['driver_oil_physical','driver_freight','driver_institutional_flows','driver_india_macro','driver_real_economy','driver_sector_breadth'];
const RISK_WEIGHTS = [3,2,3,3,2,2];

// ──────────────────────────────────────────────────────────────────────
// Main entry · mutates metrics map in-place
// ──────────────────────────────────────────────────────────────────────

export function recomputeComposites(metrics) {
  const changes = [];

  // 1 · Drivers
  for (const d of DRIVER_DEFS) {
    const dm = metrics.get(d.id);
    if (!dm) continue;

    if (applyManualOverride(dm)) {
      changes.push({ id: d.id, source: 'manual_override', new: dm.value });
      continue;
    }

    const oldVal = dm.value;
    const health = feederHealth(metrics, d.ids);
    dm.feeder_freshness = health;

    if (health.missing_pct > MISSING_DATA_THRESHOLD * 100) {
      dm.value = null;
      dm.score_state = 'insufficient_data';
      dm.score_state_reason = `${health.missing_pct.toFixed(0)}% of feeders stale/missing (threshold ${MISSING_DATA_THRESHOLD * 100}%)`;
      changes.push({ id: d.id, old: oldVal, new: null, reason: 'insufficient_data' });
    } else {
      const res = driverScore(metrics, d.ids, d.weights);
      dm.value = res.value;
      dm.score_state = 'fresh';
      dm.score_state_reason = null;
      dm.feeder_breakdown = res.usedFeeders;
      dm.missing_feeders = res.missingFeeders;
      if (oldVal !== res.value) {
        dm._composite_was = oldVal;
        changes.push({ id: d.id, old: oldVal, new: res.value });
      }
    }

    // Always populate regime + shock split if we have sparkline data
    const rs = regimeAndShock(dm);
    dm.regime_score = rs.regime_score;
    dm.point_move_30d = rs.point_move_30d;
    dm.shock_indicator = rs.shock_indicator;
    dm.shock_direction = rs.shock_direction;
  }

  // 2 · Sector breadth · unchanged (derived in derived_v1, raw-value-based)
  //     But we still propagate freshness + regime/shock fields.
  const sb = metrics.get('driver_sector_breadth');
  if (sb && !applyManualOverride(sb)) {
    const rs = regimeAndShock(sb);
    sb.regime_score = rs.regime_score;
    sb.point_move_30d = rs.point_move_30d;
    sb.shock_indicator = rs.shock_indicator;
    sb.shock_direction = rs.shock_direction;
    sb.score_state = (typeof sb.value === 'number') ? 'fresh' : 'insufficient_data';
  }

  // 3 · India Risk Score · correlation-adjusted top-level
  const irs = metrics.get('india_risk_score');
  if (irs) {
    if (applyManualOverride(irs)) {
      changes.push({ id: 'india_risk_score', source: 'manual_override', new: irs.value });
    } else {
      const driverInputs = RISK_DRIVERS.map((id, i) => {
        const d = metrics.get(id);
        return { id, value: (d && typeof d.value === 'number') ? d.value : null, weight: RISK_WEIGHTS[i] };
      });

      // Missing-data check at top level
      const presentCount = driverInputs.filter(d => d.value !== null).length;
      const totalCount = driverInputs.length;
      const missingPct = 100 * (totalCount - presentCount) / totalCount;

      if (missingPct > MISSING_DATA_THRESHOLD * 100) {
        const oldVal = irs.value;
        irs.value = null;
        irs.score_state = 'insufficient_data';
        irs.score_state_reason = `${missingPct.toFixed(0)}% of drivers in insufficient_data state`;
        changes.push({ id: 'india_risk_score', old: oldVal, new: null, reason: 'insufficient_data' });
      } else {
        const adj = correlationAdjusted(driverInputs, RISK_WEIGHTS);
        const oldVal = irs.value;
        irs.value = adj.value;
        irs.score_state = 'fresh';
        irs.raw_weighted_avg = adj.raw;
        irs.correlation_adjustment = adj.adjustment;
        irs.driver_inputs = driverInputs;
        if (oldVal !== adj.value) {
          irs._composite_was = oldVal;
          changes.push({ id: 'india_risk_score', old: oldVal, new: adj.value });
        }
      }
    }

    // Triple jeopardy + regime/shock + reference events
    irs.triple_jeopardy = checkTripleJeopardy(metrics);
    const rs = regimeAndShock(irs);
    irs.regime_score = rs.regime_score;
    irs.point_move_30d = rs.point_move_30d;
    irs.shock_indicator = rs.shock_indicator;
    irs.shock_direction = rs.shock_direction;
    irs.reference_events = REFERENCE_EVENTS;
  }

  // 4 · Composite anomaly detector retained (z>3 on sparkline_12m)
  const ALL_COMPOSITES = [...DRIVER_DEFS.map(d => d.id), 'india_risk_score', 'driver_sector_breadth'];
  for (const id of ALL_COMPOSITES) {
    const m = metrics.get(id);
    if (!m || typeof m.value !== 'number') continue;
    const spark = Array.isArray(m.sparkline_12m) ? m.sparkline_12m : [];
    const nums = spark.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (nums.length < 5) continue;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const stddev = Math.sqrt(variance) || 1e-9;
    const z = Math.abs((m.value - mean) / stddev);
    if (z > 3) {
      m.composite_anomaly = { z: +z.toFixed(2), mean: +mean.toFixed(1), stddev: +stddev.toFixed(1) };
    } else {
      delete m.composite_anomaly;
    }
  }

  return changes;
}

// Exports for testing
export {
  zScoreToRiskScore, feederScore, feederHealth, driverScore,
  correlationAdjusted, checkTripleJeopardy, regimeAndShock,
  RHO, REFERENCE_EVENTS, TRIPLE_JEOPARDY, DRIVER_DEFS, RISK_DRIVERS, RISK_WEIGHTS
};
