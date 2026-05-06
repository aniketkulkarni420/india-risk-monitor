#!/usr/bin/env node
// Bundle all metric JSONs into a single fast-load file at app/dist/data.json.
// Phase 5 dependency. Renderer fetches this once instead of 70 individual files.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';
import { freshnessFor } from './freshness-spec.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');
const OUT = join(ROOT, 'app', 'dist', 'data.json');

mkdirSync(dirname(OUT), { recursive: true });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && name !== 'manifest.json') out.push(p);
  }
  return out;
}

// Read the previous-day value from history CSV. Returns null if history is
// too thin to compute a meaningful day-over-day change.
function previousDayValue(metric_id, currentAsOf) {
  const file = join(HISTORY, `${metric_id}.csv`);
  if (!existsSync(file)) return null;
  let rows;
  try {
    rows = readFileSync(file, 'utf8').trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(r => r.length === 2 && !Number.isNaN(parseFloat(r[1])))
      .map(r => ({ date: r[0], value: parseFloat(r[1]) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return null; }
  if (rows.length < 2) return null;
  // Find the entry just before the most recent
  const last = rows[rows.length - 1];
  // Walk back to find a row with a different value (skip duplicate same-day rows)
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].date !== last.date) return rows[i];
  }
  return null;
}

// Sanitize sparkline_12m at bundle time. If the array contains a unit-shift
// remnant (max/min ratio > 50), keep only the values that share an order of
// magnitude with the current value. Catches Phase-1 seed values that hang
// around when a parser ships with different units.
function sanitizeSparkline(metric) {
  if (!Array.isArray(metric.sparkline_12m) || metric.sparkline_12m.length === 0) return;
  const sl = metric.sparkline_12m.filter(v => typeof v === 'number');
  if (sl.length === 0) return;
  const cur = metric.value;
  if (typeof cur !== 'number' || cur === 0) return;
  const positives = sl.map(Math.abs).filter(v => v > 0);
  if (positives.length < 2) return;
  const max = Math.max(...positives);
  const min = Math.min(...positives);
  if (max / min < 50) return;  // sparkline is fine, no shift detected

  // Unit shift detected. Keep only values within 0.3x-3x of current value.
  const lo = Math.abs(cur) * 0.3;
  const hi = Math.abs(cur) * 3.0;
  const clean = metric.sparkline_12m.filter(v =>
    typeof v === 'number' && Math.abs(v) >= lo && Math.abs(v) <= hi
  );
  metric.sparkline_12m = clean;
  metric._sparkline_sanitized = `dropped ${sl.length - clean.length} unit-shift values`;
}

// Sanity guard for day-over-day deltas. The history CSV may contain Phase-1
// mock-seed values from before a parser was registered; when the parser later
// switched to real data with different units / sign convention, the prev/current
// ratio explodes. We refuse to publish dod if any of these is true:
//   1. |dod_pct| > 25 AND metric is not shock_eligible (rate moves > 25/day are
//      either a unit shift or a genuine event we should treat carefully)
//   2. ratio current/prev is outside [0.5, 2.0] (suggests unit shift)
//   3. sign flipped between prev and current AND metric isn't naturally zero-crossing
function dodIsTrustworthy(metric, prev) {
  const cur = metric.value;
  if (typeof cur !== 'number' || typeof prev?.value !== 'number') return false;
  if (prev.value === 0) return false;
  const dodPct = ((cur - prev.value) / Math.abs(prev.value)) * 100;
  // (1) magnitude check
  const isShockEligible = !!metric.shock_eligible;
  if (Math.abs(dodPct) > 25 && !isShockEligible) return false;
  // (2) ratio check
  const ratio = cur / prev.value;
  if (Math.abs(ratio) < 0.5 || Math.abs(ratio) > 2.0) return false;
  // (3) sign flip check (allow only if metric naturally crosses zero — spreads, deltas)
  const allowSignFlip = ['ind_us_10y_spread', 'high_yield_credit_spread', 'wacr_repo_spread', 'real_10y_yield'].includes(metric.metric_id)
    || metric.value_format === 'bps';
  if (!allowSignFlip && Math.sign(cur) !== Math.sign(prev.value) && cur !== 0 && prev.value !== 0) return false;
  return true;
}

const metrics = {};
let sectors = null;
let dodAccepted = 0, dodRejected = 0, sparklineSanitized = 0;

for (const file of walk(DATA)) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.metric_id) {
    // Sanitize sparkline first (unit-shift detection)
    sanitizeSparkline(data);
    if (data._sparkline_sanitized) sparklineSanitized++;

    // Compute day-over-day delta + percentage if history allows AND data is trustworthy
    const prev = previousDayValue(data.metric_id, data.as_of);
    if (prev && dodIsTrustworthy(data, prev)) {
      data.dod_delta = +(data.value - prev.value).toFixed(4);
      data.dod_pct = +(((data.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(2);
      data.dod_prev_date = prev.date;
      data.dod_prev_value = prev.value;
      dodAccepted++;
    } else if (prev) {
      dodRejected++;
    }
    // Freshness flag · derived from per-metric expected cadence (freshness-spec.mjs).
    // is_stale = true when (today - as_of) > cadence_days. UI surfaces a STALE
    // pill so users can see at scan-time which numbers are past their refresh window.
    const fr = freshnessFor(data.metric_id, data.as_of);
    data.is_stale = fr.is_stale;
    data.age_days = fr.age_days;
    data.cadence_days = fr.cadence_days;
    metrics[data.metric_id] = data;
  } else if (data.section === 'sectors' && Array.isArray(data.sectors)) {
    sectors = data;
  }
}
console.log(`  · dod accepted: ${dodAccepted} · rejected (unit shift / sign flip / mock seed): ${dodRejected}`);
if (sparklineSanitized > 0) console.log(`  · sparkline sanitized (unit-shift remnants dropped): ${sparklineSanitized}`);

const bundle = {
  generated_at: new Date().toISOString(),
  metric_count: Object.keys(metrics).length,
  metrics,
  sectors
};

writeFileSync(OUT, JSON.stringify(bundle), 'utf8');
console.log(`✓ bundled ${bundle.metric_count} metrics + ${sectors ? sectors.sectors.length : 0} sectors → app/dist/data.json (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`);
