#!/usr/bin/env node
// Bundle all metric JSONs into a single fast-load file at app/dist/data.json.
// Phase 5 dependency. Renderer fetches this once instead of 70 individual files.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';

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

const metrics = {};
let sectors = null;

for (const file of walk(DATA)) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.metric_id) {
    // Compute day-over-day delta + percentage if history allows
    const prev = previousDayValue(data.metric_id, data.as_of);
    if (prev && typeof data.value === 'number' && typeof prev.value === 'number' && prev.value !== 0) {
      data.dod_delta = +(data.value - prev.value).toFixed(4);
      data.dod_pct = +(((data.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(2);
      data.dod_prev_date = prev.date;
      data.dod_prev_value = prev.value;
    }
    metrics[data.metric_id] = data;
  } else if (data.section === 'sectors' && Array.isArray(data.sectors)) {
    sectors = data;
  }
}

const bundle = {
  generated_at: new Date().toISOString(),
  metric_count: Object.keys(metrics).length,
  metrics,
  sectors
};

writeFileSync(OUT, JSON.stringify(bundle), 'utf8');
console.log(`✓ bundled ${bundle.metric_count} metrics + ${sectors ? sectors.sectors.length : 0} sectors → app/dist/data.json (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`);
