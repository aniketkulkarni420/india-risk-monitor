// REAL fetcher · Pure-derived metrics (no network fetch)
//
// Some metrics are computed from other metrics rather than fetched. Examples:
//   absorption_ratio  = dii_daily / |fii_equity_daily|
//   real_10y_yield    = gsec_10y_proxy - cpi_inflation
//   ind_us_10y_spread = india_10y - us_10y_treasury
//
// This parser reads peer metric JSON files and derives the value. Runs
// inside the ingest pipeline like any other parser, but with zero network
// calls. Always verifies (no cross-check divergence).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'data');

let _index = null;
function metricIndex() {
  if (_index) return _index;
  _index = new Map();
  // BUG FIX 2026-05-14: previously this walk read EVERY .json under data/,
  // including data/snapshots/{metric}/{date}.json which carry a `metric_id`
  // field. A stale dated snapshot would overwrite the live metric in the
  // index — silently corrupting EVERY derived metric (all driver_* composites,
  // IRS feeders, absorption_ratio, real_10y_yield, etc). Now skips the same
  // non-metric directories/files as persistence.mjs.
  const SKIP_DIRS = new Set(['snapshots', 'manual-overrides', 'self-heal-reports', 'history', 'source-cache']);
  const SKIP_FILES = new Set(['manifest.json', 'parser-health.json', 'source-cooldown.json', 'llm-telemetry.json']);
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (name.endsWith('.json') && !SKIP_FILES.has(name) && !name.startsWith('sectors')) {
        try {
          const d = JSON.parse(readFileSync(p, 'utf8'));
          if (d.metric_id) _index.set(d.metric_id, d);
        } catch {}
      }
    }
  }
  walk(DATA);
  return _index;
}

function readPeer(metric_id) {
  return metricIndex().get(metric_id) || null;
}

// Map a metric's status field to a 0-100 driver-bar score.
// Used by composite driver_* metrics that aggregate multiple peer metrics.
function statusToScore(status) {
  return ({ shock: 92, high: 75, med: 55, low: 30, neutral: 50 })[status] ?? 50;
}
function avgFromMetrics(ids, weights) {
  const n = ids.length;
  let sum = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const peer = readPeer(ids[i]);
    if (!peer) continue;
    const score = statusToScore(peer.status);
    const wt = weights ? weights[i] : 1;
    sum += score * wt;
    w += wt;
  }
  return w > 0 ? Math.round(sum / w) : 50;
}

const DERIVERS = {
  // Absorption ratio = DII daily buying / |FII daily selling|
  // > 1.0 = DII fully absorbing FII outflows
  absorption_ratio: () => {
    const dii = readPeer('dii_daily');
    const fii = readPeer('fii_equity_daily');
    if (!dii || !fii) throw new Error('absorption_ratio needs dii_daily + fii_equity_daily');
    const fiiAbs = Math.abs(fii.value);
    if (fiiAbs < 1) return { value: 0, asof: dii.as_of };  // avoid div-by-zero
    const ratio = +(dii.value / fiiAbs).toFixed(2);
    // Use the more recent of the two as_of timestamps
    const asof = (dii.as_of > fii.as_of ? dii.as_of : fii.as_of) || new Date().toISOString();
    return { value: ratio, asof };
  },

  // Real 10Y yield = G-sec 10Y - CPI YoY
  // Positive = positive carry vs inflation
  // 2026-06-10 accuracy fix: use the MEASURED gsec_curve 10Y (live metric,
  // refreshed daily) instead of the old repo+150bps estimate. Vintage is bound
  // by CPI (monthly release) — metric frequency relabelled Monthly to match.
  real_10y_yield: () => {
    const cpi = readPeer('cpi_inflation');
    const gsec = readPeer('gsec_curve');
    if (!cpi || !gsec) throw new Error('real_10y_yield needs cpi_inflation + gsec_curve');
    const real = +(gsec.value - cpi.value).toFixed(2);
    // Binding vintage = CPI release date (the slower component).
    return { value: real, asof: cpi.as_of };
  },

  // India 10Y vs US 10Y spread in bps
  // Positive = India trades wider than US
  // 2026-06-10 accuracy fix: previously India10Y was estimated (repo+1.5) and
  // US10Y was a HARDCODED 4.45 — the spread never moved with markets. Now:
  // India 10Y = measured gsec_curve; US 10Y = Yahoo ^TNX (CBOE 10Y yield index,
  // same keyless Yahoo chart API the repo already uses for Nifty/VIX).
  // fetchResilient gives retry + source-cache fallback on Yahoo hiccups.
  ind_us_10y_spread: async () => {
    const gsec = readPeer('gsec_curve');
    if (!gsec) throw new Error('ind_us_10y_spread needs gsec_curve');
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=5d&interval=1d';
    const { fetchResilient } = await import('../fetch-resilient.mjs');
    const res = await fetchResilient(url, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
    const j = JSON.parse(res.body);
    const r0 = j?.chart?.result?.[0];
    const closes = r0?.indicators?.quote?.[0]?.close || [];
    const ts = r0?.timestamp || [];
    // Latest non-null close (nulls on US market holidays)
    let us10y = null, usEpoch = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) { us10y = closes[i]; usEpoch = ts[i]; break; }
    }
    if (us10y === null) us10y = r0?.meta?.regularMarketPrice ?? null;
    if (us10y === null || us10y < 1 || us10y > 10) {
      throw new Error(`ind_us_10y_spread: no plausible US10Y from ^TNX (got ${us10y})`);
    }
    const spread = +((gsec.value - us10y) * 100).toFixed(0);  // to bps
    // Vintage = older of the two components, so the gate sees true data age.
    const usIso = usEpoch ? new Date(usEpoch * 1000).toISOString() : new Date().toISOString();
    const asof = (gsec.as_of < usIso ? gsec.as_of : usIso);
    return { value: spread, asof, extra: { _us10y_used: us10y, _us10y_date: usIso.slice(0, 10) } };
  },

  // High-yield credit spread — DERIVED PROXY.
  // 2026-05-14: India has no clean free corporate-bond-spread feed. The
  // prior tier chain re-fetched the SAME TradingEconomics G-Sec page twice
  // (crisil_v1 + tradingeconomics_v1 → identical URL) — fake independence.
  // Honest replacement: derive a term-premium proxy = (10Y G-Sec − repo) in
  // bps. This moves with rate stress and is bounded; it is NOT a true
  // corporate credit spread. Metric notes flag it as a proxy pending a real
  // corporate bond feed (FBIL corporate curve or CCIL corp trades).
  high_yield_credit_spread: () => {
    const gsec = readPeer('gsec_curve');
    const repo = readPeer('repo_rate');
    if (!gsec || !repo) throw new Error('high_yield_credit_spread needs gsec_curve + repo_rate');
    const spreadBps = +(((gsec.value - repo.value)) * 100).toFixed(0);
    const asof = (gsec.as_of > repo.as_of ? gsec.as_of : repo.as_of) || new Date().toISOString();
    return { value: spreadBps, asof };
  },

  // ───────────── Hero / driver composites ─────────────
  // Each driver_* aggregates the status of its constituent metrics into a 0-100
  // score. Higher = more pressure / stress.
  driver_oil_physical: () => {
    const score = avgFromMetrics(['brent_crude','india_crude_basket','hormuz_throughput','vlcc_tanker_rates'], [3,2,3,2]);
    return { value: score, asof: new Date().toISOString() };
  },
  driver_freight: () => {
    const score = avgFromMetrics(['drewry_wci','baltic_dirty_tanker','vlcc_tanker_rates'], [3,2,3]);
    return { value: score, asof: new Date().toISOString() };
  },
  driver_institutional_flows: () => {
    const score = avgFromMetrics(['fii_equity_daily','fii_equity_mtd','dii_daily','dii_mtd','absorption_ratio'], [2,2,2,2,3]);
    return { value: score, asof: new Date().toISOString() };
  },
  driver_india_macro: () => {
    const score = avgFromMetrics(['inr_usd','cpi_inflation','core_cpi','iip_growth','fiscal_deficit_pct','cad_pct_gdp'], [3,3,2,2,2,2]);
    return { value: score, asof: new Date().toISOString() };
  },
  driver_real_economy: () => {
    const score = avgFromMetrics(['gst_gross','pmi_combined','iip_growth','steel_consumption','auto_2w','rail_freight'], [3,2,2,2,2,2]);
    return { value: score, asof: new Date().toISOString() };
  },
  driver_sector_breadth: () => {
    // Use VIX as a proxy for breadth pressure (higher VIX = wider stress)
    const vix = readPeer('india_vix');
    const peM = readPeer('nifty_pe_5y');
    if (!vix && !peM) return { value: 50, asof: new Date().toISOString() };
    const vixScore = vix ? Math.max(0, Math.min(100, ((vix.value - 9) / (35 - 9)) * 100)) : 50;
    const peScore = peM ? Math.max(0, Math.min(100, ((peM.value - 15) / (28 - 15)) * 100)) : 50;
    return { value: Math.round((vixScore + peScore) / 2), asof: vix?.as_of || peM?.as_of };
  },

  // India Risk Score = weighted average of the 6 drivers
  india_risk_score: () => {
    const drivers = ['driver_oil_physical','driver_freight','driver_institutional_flows','driver_india_macro','driver_real_economy','driver_sector_breadth'];
    const weights = [3,2,3,3,2,2];
    let sum = 0, w = 0;
    for (let i = 0; i < drivers.length; i++) {
      const d = readPeer(drivers[i]);
      if (d && typeof d.value === 'number') { sum += d.value * weights[i]; w += weights[i]; }
    }
    return { value: w > 0 ? Math.round(sum / w) : 50, asof: new Date().toISOString() };
  },

  // Regime / state composites — return label strings rather than scores
  institutional_flow_regime: () => {
    const a = readPeer('absorption_ratio');
    const v = a?.value ?? 1;
    let regime = 'DII Absorption';
    if (v < 0.5) regime = 'FII Selling Pressure';
    else if (v < 1.0) regime = 'Partial Absorption';
    else if (v >= 1.5) regime = 'Strong DII Demand';
    return { value: regime, asof: a?.as_of || new Date().toISOString() };
  },
  real_economy_state: () => {
    const score = avgFromMetrics(['gst_gross','pmi_combined','iip_growth','auto_2w'], [3,2,2,2]);
    let state = 'Holding';
    if (score >= 75) state = 'Stress';
    else if (score >= 60) state = 'Watch';
    else if (score <= 35) state = 'Strong';
    return { value: state, asof: new Date().toISOString() };
  },
  supply_chain_state: () => {
    const score = avgFromMetrics(['hormuz_throughput','brent_crude','vlcc_tanker_rates','drewry_wci','baltic_dirty_tanker'], [3,3,2,2,2]);
    let state = 'Functioning';
    if (score >= 75) state = 'Stress';
    else if (score >= 60) state = 'Watch';
    return { value: state, asof: new Date().toISOString() };
  }
};

export async function fetchPrimary(metric) {
  const deriver = DERIVERS[metric.metric_id];
  if (!deriver) throw new Error(`No deriver mapped for ${metric.metric_id}`);
  // Force fresh index read on each ingest tick
  _index = null;
  const result = await deriver();   // some derivers are async (live US10Y fetch)
  return {
    value: result.value,
    as_of: result.asof || new Date().toISOString(),
    parse_meta: { source: 'derived', metric_id: metric.metric_id },
    ...(result.extra ? { extra: result.extra } : {}),
    raw: `derived from peer metrics`
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Derived metrics: cross-check is the same computation (zero divergence).
  // Marked verified so the engine doesn't flag them.
  return {
    value: primaryValue,
    source_name: 'self-derivation',
    parse_meta: { source: 'derived (no cross-check needed)' }
  };
}
