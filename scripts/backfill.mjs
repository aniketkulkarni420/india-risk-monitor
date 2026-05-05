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
const REAL_BACKFILLERS = {
  fx_reserves: async function fxReservesRBI(years) {
    // RBI WSS publishes weekly data going back decades.
    // CSV download URL pattern: https://rbidocs.rbi.org.in/...
    // For phase 8 framework, real implementation deferred per-metric.
    const url = 'https://www.rbi.org.in/Scripts/WSSView.aspx';
    return { source: 'RBI WSS', url, ok: false, reason: 'parser implementation pending — endpoint requires session' };
  }
  // Add more as we implement: brent_crude (EIA), nifty_50 (NSE archives), etc.
};

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
  console.log(`  ${GREEN('✓')} ${id.padEnd(30)} ${DIM(result.source.padEnd(20))} ${result.series.length} pts → ${DIM('history/' + id + '.csv')}`);
  okCount++;
}

console.log();
console.log(BOLD(`Result: ${GREEN(okCount + ' written')}, ${skipCount ? YELLOW(skipCount + ' skipped') : '0 skipped'}, ${errCount ? RED(errCount + ' errors') : '0 errors'}`));
if (!ARGS.live) console.log(DIM(`Mock mode — series synthesized. Re-run with --live + real backfiller registered for production data.`));
console.log();

process.exit(errCount ? 1 : 0);
