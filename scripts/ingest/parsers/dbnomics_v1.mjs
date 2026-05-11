// REAL fetcher · DBnomics free aggregator API
//
// DBnomics (db.nomics.world) is a free open-data aggregator that re-publishes
// time series from 80+ providers (RBI, World Bank, IMF, OECD, BIS, FRED, ECB,
// BoE, BoJ, MoSPI etc) as a single JSON API. No API key, no rate limit for
// reasonable use. Free forever.
//
// Two query forms supported:
//
//   form A · direct series:
//     /v22/series/{provider}/{dataset}/{series_id}?observations=1
//
//   form B · dimension query (recommended — more discoverable + stable):
//     /v22/series/{provider}/{dataset}?dimensions={"dim1":["v1"],"dim2":["v2"]}&observations=1
//
// To discover series codes: browse db.nomics.world UI → click a series →
// the URL contains provider/dataset/series. Verified examples below.

import { fetchResilient } from '../fetch-resilient.mjs';

const API = 'https://api.db.nomics.world/v22/series';

// Per-metric config. Either:
//   { providerDataset: 'IMF/WEO:latest', dimensions: { ... }, ... }
//   { series: 'PROVIDER/DATASET/SERIES_ID', ... }
const CONFIGS = {
  // IMF WEO India real GDP growth (annual %) — actuals only, no forecasts
  india_gdp_growth_imf: {
    providerDataset: 'IMF/WEO:latest',
    dimensions: { 'weo-country': ['IND'], 'weo-subject': ['NGDP_RPCH'] },
    plausible: (v) => v > -10 && v < 15,
    actualOnly: true
  },

  // IMF WEO India inflation, end of period (%) — actuals only
  india_inflation_eop_imf: {
    providerDataset: 'IMF/WEO:latest',
    dimensions: { 'weo-country': ['IND'], 'weo-subject': ['PCPIEPCH'] },
    plausible: (v) => v > -5 && v < 25,
    actualOnly: true
  },

  // IMF WEO India CAD as % of GDP — actuals only
  india_cad_imf: {
    providerDataset: 'IMF/WEO:latest',
    dimensions: { 'weo-country': ['IND'], 'weo-subject': ['BCA_NGDPD'] },
    plausible: (v) => v > -10 && v < 5,
    actualOnly: true
  },

  // FRED US 10Y Treasury constant maturity yield (daily)
  us_10y_yield: {
    series: 'FED/H15/RIFLGFCY10_N.B',
    plausible: (v) => v > 0 && v < 10
  }
};

function pickLatest(docs, { actualOnly = false } = {}) {
  if (!Array.isArray(docs) || !docs.length) return null;
  const d = docs[0];
  if (!Array.isArray(d.period) || !Array.isArray(d.value)) return null;
  const cutoffYear = new Date().getUTCFullYear();
  for (let i = d.value.length - 1; i >= 0; i--) {
    const v = d.value[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (actualOnly) {
      const period = d.period[i];
      // Skip if period year > current year (forecast).
      const y = parseInt(String(period).slice(0, 4), 10);
      if (Number.isFinite(y) && y > cutoffYear) continue;
    }
    return { value: v, period: d.period[i], series_name: d.series_name || null };
  }
  return null;
}

function buildUrl(cfg) {
  if (cfg.series) return `${API}/${cfg.series}?observations=1`;
  if (cfg.providerDataset && cfg.dimensions) {
    const dimsParam = encodeURIComponent(JSON.stringify(cfg.dimensions));
    return `${API}/${cfg.providerDataset}?dimensions=${dimsParam}&observations=1`;
  }
  throw new Error('dbnomics config requires either `series` or `providerDataset`+`dimensions`');
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No dbnomics config for ${metric.metric_id}`);

  const url = buildUrl(cfg);
  const res = await fetchResilient(url, { timeoutMs: 25000, retries: 2, wayback: false });

  let j;
  try { j = JSON.parse(res.body); }
  catch (e) { throw new Error(`dbnomics: invalid JSON (${e.message})`); }

  if (j?.message && !j?.series?.docs) {
    throw new Error(`dbnomics: ${j.message}`);
  }

  const latest = pickLatest(j?.series?.docs, { actualOnly: cfg.actualOnly });
  if (!latest) throw new Error(`dbnomics: no observations in response`);

  let value = cfg.valueTransform ? cfg.valueTransform(latest.value) : latest.value;
  if (!cfg.plausible(value)) {
    throw new Error(`dbnomics: ${value} outside plausible band`);
  }

  return {
    value: typeof value === 'number' ? +value.toFixed(4) : value,
    as_of: periodToIso(latest.period),
    parse_meta: { source: 'dbnomics', url, period: latest.period, series_name: latest.series_name },
    raw: `DBnomics: ${latest.value} @ ${latest.period}`
  };
}

function periodToIso(period) {
  if (!period) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Date(period + 'T00:00:00Z').toISOString();
  if (/^\d{4}-\d{2}$/.test(period)) return new Date(period + '-01T00:00:00Z').toISOString();
  const qm = period.match(/^(\d{4})-Q([1-4])$/);
  if (qm) {
    const mon = ((parseInt(qm[2], 10) - 1) * 3 + 1).toString().padStart(2, '0');
    return new Date(`${qm[1]}-${mon}-01T00:00:00Z`).toISOString();
  }
  if (/^\d{4}$/.test(period)) return new Date(`${period}-07-01T00:00:00Z`).toISOString();
  return new Date().toISOString();
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return {
    value: primaryValue,
    source_name: cc?.name || 'dbnomics-crosscheck-pending',
    parse_meta: { source: 'pending' }
  };
}

export { pickLatest, periodToIso, buildUrl };
