#!/usr/bin/env node
// 5Y history backfill orchestrator · Phase 8
//
// Pulls historical series from free sources for each metric and writes
// data/history/{metric_id}.csv (date,value) covering the last 5 years.
//
// Once accrued, the MetricDrawer's period selector (1M/3M/6M/1Y/5Y) becomes
// functional and `vs_5y_avg_pct` populates on each metric.
//
// Usage:
//   node scripts/backfill.mjs                 # all registered metrics, mock
//   node scripts/backfill.mjs --metric=brent_crude
//   node scripts/backfill.mjs --live          # real fetchers where registered
//   node scripts/backfill.mjs --years=2       # override default 5

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metricIndex } from './ingest/persistence.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HISTORY = join(ROOT, 'data', 'history');
mkdirSync(HISTORY, { recursive: true });

const ARGS = parseArgs(process.argv.slice(2));

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function parseArgs(argv) {
  const out = { live: false, years: 5 };
  for (const a of argv) {
    if (a === '--live') out.live = true;
    else if (a.startsWith('--metric=')) out.metric = a.slice(9);
    else if (a.startsWith('--years=')) out.years = parseInt(a.slice(8));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Real backfillers · registered per metric_id
// One reference implementation (RBI WSS for fx_reserves) — pattern to extend.
// ──────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Backfill/1.0';
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Helper: fetch binary buffer with abort + retry
async function fetchBuffer(url, timeoutMs = 30000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 1) throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

// Fetch text with abort + retry. Used by HTML/CSV backfillers.
async function fetchText(url, timeoutMs = 30000, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...opts.headers },
        signal: ac.signal, redirect: 'follow'
      });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 1) throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

// NSE cookie warmup (required for NSE historical API to return data).
let _nseCookies = null;
async function warmNseCookies() {
  if (_nseCookies) return _nseCookies;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      signal: ac.signal, redirect: 'follow'
    });
    const sc = res.headers.get('set-cookie') || '';
    _nseCookies = sc.split(/,(?=[^ ]+=)/).map(s => s.split(';')[0]).join('; ');
    return _nseCookies;
  } finally {
    clearTimeout(t);
  }
}

const REAL_BACKFILLERS = {
  // GST: GSTN's authoritative xlsx has 23+ monthly sheets named "MMM-YY".
  // Each sheet has a "Total Gross GST Revenue" row at column C = current month.
  // We extract every sheet → historical CSV + 12-month sparkline.
  gst_gross: async function gstFromGSTN(years) {
    const url = 'https://tutorial.gst.gov.in/offlineutilities/gst_statistics/Gross_Net_Tax_collection.xlsx';
    const buf = await fetchBuffer(url);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const series = [];
    for (const name of wb.SheetNames) {
      const m = name.match(/^([A-Za-z]{3})-(\d{2})$/);
      if (!m) continue;
      const monthIdx = MONTHS_SHORT.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
      if (monthIdx < 0) continue;
      const year = 2000 + parseInt(m[2], 10);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      const grossRow = rows.find(r => r && typeof r[0] === 'string' && /Total\s+Gross\s+GST\s+Revenue/i.test(r[0]));
      if (!grossRow) continue;
      const crore = parseFloat(grossRow[2]);
      if (!Number.isFinite(crore)) continue;
      // Last day of reporting month
      const dt = new Date(year, monthIdx + 1, 0);
      const dateStr = dt.toISOString().slice(0, 10);
      const lakhCrore = +(crore / 100000).toFixed(4);
      series.push({ date: dateStr, value: lakhCrore });
    }
    series.sort((a, b) => a.date.localeCompare(b.date));
    return { source: 'GSTN xlsx', ok: true, series };
  },

  // Brent crude daily price from FRED (St Louis Fed). Free, no auth, daily.
  // Series ID: DCOILBRENTEU. Years arg controls how far back we pull.
  // Note: from local terminal this often times out; runs cleanly from CI.
  brent_crude: async function brentFromFRED(years) {
    const cosd = new Date();
    cosd.setFullYear(cosd.getFullYear() - years);
    const today = new Date();
    const fmtDate = (d) => d.toISOString().slice(0, 10);
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=${fmtDate(cosd)}&coed=${fmtDate(today)}`;
    const csv = await fetchText(url, 60000);
    const lines = csv.trim().split('\n').slice(1);
    const series = [];
    for (const line of lines) {
      const [date, raw] = line.split(',');
      if (!date || raw === '.' || raw === '' || raw == null) continue;
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) continue;
      series.push({ date, value: +v.toFixed(2) });
    }
    if (series.length === 0) throw new Error('FRED Brent series empty');
    return { source: 'FRED DCOILBRENTEU', ok: true, series };
  },

  // Nifty 50 daily close from NSE historical-indices API. Required: cookie warmup.
  // From local terminal NSE returns 403/503; from CI (or India IP) it works.
  nifty_50: async function niftyFromNSE(years) {
    const cookies = await warmNseCookies();
    const today = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - years);
    const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    const url = `https://www.nseindia.com/api/historical/indicesHistory?indexType=NIFTY%2050&from=${ddmmyyyy(from)}&to=${ddmmyyyy(today)}`;
    const txt = await fetchText(url, 30000, {
      headers: { 'Cookie': cookies, 'Referer': 'https://www.nseindia.com/market-data/live-market-indices', 'Accept': 'application/json' }
    });
    let json;
    try { json = JSON.parse(txt); } catch { throw new Error('NSE response not JSON (likely WAF block)'); }
    const rows = json?.data?.indexCloseOnlineRecords || [];
    if (!rows.length) throw new Error('NSE empty rows · WAF or schema change');
    const series = rows.map(r => {
      const [d, m, y] = (r.EOD_TIMESTAMP || '').split('-');
      return { date: `${y}-${m}-${d}`, value: +parseFloat(r.EOD_CLOSE_INDEX_VAL).toFixed(2) };
    }).filter(p => p.date && Number.isFinite(p.value));
    series.sort((a, b) => a.date.localeCompare(b.date));
    return { source: 'NSE indicesHistory', ok: true, series };
  },

  // Bank Nifty: same NSE endpoint, different indexType
  bank_nifty: async function bankNiftyFromNSE(years) {
    const cookies = await warmNseCookies();
    const today = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - years);
    const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    const url = `https://www.nseindia.com/api/historical/indicesHistory?indexType=NIFTY%20BANK&from=${ddmmyyyy(from)}&to=${ddmmyyyy(today)}`;
    const txt = await fetchText(url, 30000, {
      headers: { 'Cookie': cookies, 'Referer': 'https://www.nseindia.com/market-data/live-market-indices', 'Accept': 'application/json' }
    });
    let json;
    try { json = JSON.parse(txt); } catch { throw new Error('NSE response not JSON (likely WAF block)'); }
    const rows = json?.data?.indexCloseOnlineRecords || [];
    if (!rows.length) throw new Error('NSE empty rows · WAF or schema change');
    const series = rows.map(r => {
      const [d, m, y] = (r.EOD_TIMESTAMP || '').split('-');
      return { date: `${y}-${m}-${d}`, value: +parseFloat(r.EOD_CLOSE_INDEX_VAL).toFixed(2) };
    }).filter(p => p.date && Number.isFinite(p.value));
    series.sort((a, b) => a.date.localeCompare(b.date));
    return { source: 'NSE indicesHistory', ok: true, series };
  }
};

// Update metric JSON's sparkline_12m + mom_pct + yoy_pct from the historical
// series. Series is assumed sorted oldest → newest. Sparkline aggregates to 12
// month-end values (last 12 series points if cadence is monthly, else samples).
function updateMetricFromSeries(metric, series) {
  if (!series || series.length === 0) return null;
  // Take last 12 points for sparkline_12m (works for monthly; for daily we'd
  // typically resample, but for this iteration we keep simple)
  const last12 = series.slice(-12).map(p => p.value);
  while (last12.length < 12) last12.unshift(last12[0]);  // pad if short

  const current = series[series.length - 1].value;
  const monthBack = series[series.length - 2];
  const yearBack = series.length >= 13 ? series[series.length - 13] : null;
  const out = {
    sparkline_12m: last12,
    value: current,
    as_of: new Date(series[series.length - 1].date + 'T17:30:00+05:30').toISOString()
  };
  if (monthBack && monthBack.value !== 0) {
    out.mom_pct = +(((current - monthBack.value) / monthBack.value) * 100).toFixed(2);
  }
  if (yearBack && yearBack.value !== 0) {
    out.yoy_pct = +(((current - yearBack.value) / yearBack.value) * 100).toFixed(2);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Mock backfiller — synthesises realistic 5Y series from current value
// Used when no real backfiller registered, OR when --live is off.
// ──────────────────────────────────────────────────────────────
function mockBackfill(metric, years) {
  const now = new Date();
  const series = [];
  const currentValue = typeof metric.value === 'number' ? metric.value : 100;
  const cadenceDays = ({ '24h': 1, live: 1, weekly: 7, fortnightly: 14, monthly: 30, quarterly: 90 })[metric.as_of_period] || 30;
  const periods = Math.floor((years * 365) / cadenceDays);

  // Walk backwards from current value with random walk + drift
  let v = currentValue;
  for (let i = 0; i <= periods; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i * cadenceDays);
    const dateStr = date.toISOString().slice(0, 10);
    series.unshift({ date: dateStr, value: typeof v === 'number' ? +v.toFixed(4) : v });
    if (typeof v === 'number' && v !== 0) {
      // Multiplicative random walk with mean-reversion to current value
      const reversionPull = (currentValue - v) * 0.005;
      const noise = (Math.random() - 0.5) * Math.abs(v) * 0.015;
      v = v + reversionPull + noise;
      // Clamp to plausible range — never negative for positive metrics, never zero-cross
      if (currentValue > 0) v = Math.max(currentValue * 0.3, v);
      if (currentValue < 0) v = Math.min(currentValue * 0.3, v);
    }
  }
  return { series, source: 'mock', ok: true };
}

// ──────────────────────────────────────────────────────────────
// Walk + backfill
// ──────────────────────────────────────────────────────────────
const targets = ARGS.metric
  ? [ARGS.metric]
  : Array.from(metricIndex().keys()).filter(id => !id.startsWith('driver_') && !['india_risk_score','institutional_flow_regime','real_economy_state','supply_chain_state'].includes(id));

console.log(BOLD('\nIRM backfill · Phase 8'));
console.log(DIM(`  ${targets.length} metrics · years=${ARGS.years} · mode=${ARGS.live ? 'LIVE' : 'MOCK'}\n`));

let okCount = 0, skipCount = 0, errCount = 0;

for (const id of targets) {
  const file = join(HISTORY, `${id}.csv`);
  let metric;
  try {
    const path = metricIndex().get(id);
    if (!path) throw new Error('metric not in index');
    metric = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log(`  ${RED('✗')} ${id.padEnd(30)} ${RED(e.message)}`);
    errCount++; continue;
  }

  let result;
  if (ARGS.live && REAL_BACKFILLERS[id]) {
    try { result = await REAL_BACKFILLERS[id](ARGS.years); }
    catch (e) { result = { ok: false, reason: e.message }; }
  } else {
    result = mockBackfill(metric, ARGS.years);
  }

  if (!result.ok) {
    console.log(`  ${YELLOW('⚠')} ${id.padEnd(30)} ${DIM(result.source || 'no parser')} → ${YELLOW(result.reason)}`);
    skipCount++; continue;
  }

  const csv = 'date,value\n' + result.series.map(p => `${p.date},${p.value}`).join('\n') + '\n';
  writeFileSync(file, csv, 'utf8');

  // For LIVE backfills, also update the metric JSON's sparkline_12m + trends
  // from the real series. Mock backfill does not — its synthetic series would
  // poison the trend fields.
  let updated = '';
  if (ARGS.live && REAL_BACKFILLERS[id]) {
    const update = updateMetricFromSeries(metric, result.series);
    if (update) {
      const path = metricIndex().get(id);
      const merged = { ...metric, ...update };
      writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      updated = ` · sparkline+trends updated (mom ${update.mom_pct ?? '—'} · yoy ${update.yoy_pct ?? '—'})`;
    }
  }
  console.log(`  ${GREEN('✓')} ${id.padEnd(30)} ${DIM(result.source.padEnd(20))} ${result.series.length} pts → ${DIM('history/' + id + '.csv')}${updated}`);
  okCount++;
}

console.log();
console.log(BOLD(`Result: ${GREEN(okCount + ' written')}, ${skipCount ? YELLOW(skipCount + ' skipped') : '0 skipped'}, ${errCount ? RED(errCount + ' errors') : '0 errors'}`));
if (!ARGS.live) console.log(DIM(`Mock mode — series synthesized. Re-run with --live + real backfiller registered for production data.`));
console.log();

process.exit(errCount ? 1 : 0);
