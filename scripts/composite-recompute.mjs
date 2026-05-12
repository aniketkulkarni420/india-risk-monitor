// Composite re-derivation at bundle time · 2026-05-06
// Drivers + risk score in derived_v1.mjs read peer metric STATUS at ingest
// time. After bundle runs evaluateStatus() to fix stale status fields, the
// composites would still reflect the OLD pre-recompute status values until
// the next ingest cycle. This module re-runs the same derivation against
// the freshly-recomputed in-memory metrics map, so composites always match
// the corrected statuses.
//
// Mirrors derived_v1.mjs::DERIVERS but operates on a Map<id, metric> rather
// than reading source JSON files. Same formulas, same weights.

const STATUS_TO_SCORE = { shock: 92, high: 75, med: 55, low: 30, neutral: 50 };

function statusScore(metric) {
  if (!metric) return 50;
  return STATUS_TO_SCORE[metric.status] ?? 50;
}

function avgFromMetrics(map, ids, weights) {
  let sum = 0, w = 0;
  for (let i = 0; i < ids.length; i++) {
    const peer = map.get(ids[i]);
    if (!peer) continue;
    const score = statusScore(peer);
    const wt = weights ? weights[i] : 1;
    sum += score * wt;
    w += wt;
  }
  return w > 0 ? Math.round(sum / w) : 50;
}

const DRIVER_DEFS = [
  { id: 'driver_oil_physical',        ids: ['brent_crude','india_crude_basket','hormuz_throughput','vlcc_tanker_rates'], weights: [3,2,3,2] },
  { id: 'driver_freight',             ids: ['drewry_wci','baltic_dry_index','vlcc_tanker_rates','india_port_dwell_time'], weights: [3,2,3,2] },
  { id: 'driver_institutional_flows', ids: ['fii_equity_daily','fii_equity_mtd','dii_daily','dii_mtd','absorption_ratio'], weights: [2,2,2,2,3] },
  { id: 'driver_india_macro',         ids: ['inr_usd','cpi_inflation','wpi_inflation','iip_growth','fiscal_deficit_pct','cad_pct_gdp'], weights: [3,3,2,2,2,2] },
  { id: 'driver_real_economy',        ids: ['gst_gross','pmi_combined','iip_growth','steel_consumption','auto_2w','rail_freight'], weights: [3,2,2,2,2,2] },
];

const RISK_DRIVERS = ['driver_oil_physical','driver_freight','driver_institutional_flows','driver_india_macro','driver_real_economy','driver_sector_breadth'];
const RISK_WEIGHTS = [3,2,3,3,2,2];

// Freshness propagation · Tier B addition 2026-05-12
// Composite should know how many of its feeders are stale. If >50% are
// stale, mark the composite "partial" so the UI can show a degraded badge.
function feederFreshness(map, ids) {
  let total = 0, stale = 0;
  const now = Date.now();
  for (const id of ids) {
    const m = map.get(id);
    if (!m) continue;
    total++;
    const lv = m.last_verified_at;
    if (!lv) { stale++; continue; }
    const ageDays = (now - new Date(lv).getTime()) / 86400000;
    // Heuristic: any feeder unverified >7 days is stale for composite purposes
    if (ageDays > 7) stale++;
  }
  return { total, stale, fresh_pct: total ? +(100 * (total - stale) / total).toFixed(1) : null };
}

// Recompute composite scores from current peer status. Mutates `metrics` map.
// Returns array of {id, oldValue, newValue} for ones that actually changed.
export function recomputeComposites(metrics) {
  const changes = [];
  // 1 · Drivers (5 of 6 use status-aggregation)
  for (const d of DRIVER_DEFS) {
    const dm = metrics.get(d.id);
    if (!dm) continue;
    const oldVal = dm.value;
    const newVal = avgFromMetrics(metrics, d.ids, d.weights);
    if (oldVal !== newVal) {
      dm._composite_was = oldVal;
      dm.value = newVal;
      changes.push({ id: d.id, old: oldVal, new: newVal });
    }
    // Propagate freshness signal
    const f = feederFreshness(metrics, d.ids);
    dm.feeder_freshness = f;
    if (f.total > 0 && f.stale / f.total > 0.5) {
      dm.freshness_state = 'partial';
    } else {
      dm.freshness_state = 'fresh';
    }
  }
  // 2 · Sector breadth (uses VIX + PE values, not statuses — leave as-is unless
  //     we detect an obvious staleness; safer to leave it for derived_v1 next run)
  // 3 · India risk score · weighted avg of 6 drivers
  const irs = metrics.get('india_risk_score');
  if (irs) {
    let sum = 0, w = 0;
    for (let i = 0; i < RISK_DRIVERS.length; i++) {
      const d = metrics.get(RISK_DRIVERS[i]);
      if (d && typeof d.value === 'number') {
        sum += d.value * RISK_WEIGHTS[i];
        w += RISK_WEIGHTS[i];
      }
    }
    const newVal = w > 0 ? Math.round(sum / w) : 50;
    if (irs.value !== newVal) {
      irs._composite_was = irs.value;
      irs.value = newVal;
      changes.push({ id: 'india_risk_score', old: irs.value, new: newVal });
    }
  }
  return changes;
}
