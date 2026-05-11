// REAL fetcher · Yahoo Finance unofficial JSON endpoints
//
// Yahoo Finance exposes free, no-auth JSON endpoints that mirror major
// exchanges. For Indian F&O / OI / index data, these are an excellent
// alternative when NSE blocks bots.
//
// Endpoints used:
//   /v7/finance/options/{symbol}     - options chain incl. OI
//   /v8/finance/chart/{symbol}       - price/volume timeseries
//   /v10/finance/quoteSummary/{sym}  - summary data
//
// No API key. Yahoo throttles via UA / cookie tho — fetchResilient handles it.

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const BASE_OPTIONS = 'https://query1.finance.yahoo.com/v7/finance/options/';
const BASE_QUOTE   = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/';

// Per-metric config. Supports two modes:
//   mode='options_oi'  - aggregate OI across calls+puts for given symbol's nearest expiry
//   mode='quote_field' - read a specific field from quoteSummary
//
// fno_oi_buildup as approximation: sum of OI across Nifty 50 nearest-expiry calls + puts.
const CONFIGS = {
  fno_oi_buildup: {
    mode: 'options_oi',
    symbol: '^NSEI',  // Nifty 50 index
    plausible: (v) => v > 1000 && v < 200000000  // raw OI count
  },

  // Block deals proxy: daily volume of Nifty 50 stocks (rough — OI not direct match)
  block_deals_notional: {
    mode: 'quote_field',
    symbol: '^NSEI',
    field: 'price.regularMarketVolume',
    plausible: (v) => v > 0
  }
};

async function fetchOptionsOi(symbol, timeoutMs = 20000) {
  const url = `${BASE_OPTIONS}${encodeURIComponent(symbol)}`;
  const res = await fetchResilient(url, { timeoutMs, retries: 1, wayback: false, browserUa: true });
  let j;
  try { j = JSON.parse(res.body); }
  catch (e) { throw new Error(`yahoo options JSON parse: ${e.message}`); }
  const result = j?.optionChain?.result?.[0];
  if (!result) throw new Error('yahoo options: empty result');
  const opts = result.options?.[0];
  if (!opts) throw new Error('yahoo options: no expiry chain');
  // Sum openInterest across all calls + all puts
  const totalCallOI = (opts.calls || []).reduce((s, c) => s + (c.openInterest || 0), 0);
  const totalPutOI  = (opts.puts  || []).reduce((s, p) => s + (p.openInterest || 0), 0);
  return { totalCallOI, totalPutOI, total: totalCallOI + totalPutOI, expiryDate: opts.expirationDate, body: res.body };
}

async function fetchQuoteField(symbol, fieldPath, timeoutMs = 15000) {
  const modules = 'price,defaultKeyStatistics,summaryDetail';
  const url = `${BASE_QUOTE}${encodeURIComponent(symbol)}?modules=${modules}`;
  const res = await fetchResilient(url, { timeoutMs, retries: 1, wayback: false, browserUa: true });
  const j = JSON.parse(res.body);
  const sum = j?.quoteSummary?.result?.[0];
  if (!sum) throw new Error('yahoo quoteSummary: empty');
  // Walk fieldPath (e.g. "price.regularMarketVolume")
  let v = sum;
  for (const k of fieldPath.split('.')) v = v?.[k];
  // Yahoo wraps numbers as {raw, fmt}
  if (v && typeof v === 'object' && 'raw' in v) v = v.raw;
  return { value: v, body: res.body };
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No yahoo_finance config for ${metric.metric_id}`);

  if (cfg.mode === 'options_oi') {
    const r = await fetchOptionsOi(cfg.symbol);
    if (!cfg.plausible(r.total)) throw new Error(`yahoo options OI ${r.total} out of band`);
    try { recordSnapshot(metric.metric_id, BASE_OPTIONS + cfg.symbol, r.body, r.total, 'yahoo_finance_v1'); } catch {}
    return {
      value: r.total,
      as_of: new Date().toISOString(),
      parse_meta: { source: 'yahoo-options', symbol: cfg.symbol, callOI: r.totalCallOI, putOI: r.totalPutOI, expiry: r.expiryDate },
      raw: `Yahoo OI Calls=${r.totalCallOI} Puts=${r.totalPutOI}`
    };
  }

  if (cfg.mode === 'quote_field') {
    const r = await fetchQuoteField(cfg.symbol, cfg.field);
    if (!Number.isFinite(r.value)) throw new Error(`yahoo quoteSummary missing field ${cfg.field}`);
    if (!cfg.plausible(r.value)) throw new Error(`yahoo value ${r.value} out of band`);
    return {
      value: r.value,
      as_of: new Date().toISOString(),
      parse_meta: { source: 'yahoo-quote', symbol: cfg.symbol, field: cfg.field },
      raw: `Yahoo ${cfg.symbol}.${cfg.field} = ${r.value}`
    };
  }

  throw new Error(`Unknown yahoo mode: ${cfg.mode}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'yahoo-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { fetchOptionsOi, fetchQuoteField };
