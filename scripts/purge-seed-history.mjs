#!/usr/bin/env node
// C1 · 2026-06-11 · Purge synthetic seed rows from data/history/*.csv and
// rebuild sparkline_12m from surviving REAL rows.
//
// Rule: a history row is REAL only if it carries a source tag (3rd CSV column,
// written by appendHistory since the extended schema). Untagged rows are
// either launch-time synthetic seeds (dates fabricated 2021→2026) or
// unprovable early writes — both are purged. Fake data must not be renderable
// by ANY code path, present or future.
//
// Usage:
//   node scripts/purge-seed-history.mjs            # purge + rebuild sparklines
//   node scripts/purge-seed-history.mjs --dry-run  # report only
//
// A full pre-purge copy is written to data/snapshots/history-pre-purge-<date>/
// (and git history retains every prior version regardless).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HISTORY = join(ROOT, 'data', 'history');
const METRICS = join(ROOT, 'data', 'metrics');
const DRY = process.argv.includes('--dry-run');

const stamp = new Date().toISOString().slice(0, 10);
const SNAP = join(ROOT, 'data', 'snapshots', `history-pre-purge-${stamp}`);

export function splitRows(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0] && /^date,/i.test(lines[0]) ? lines[0] : null;
  const rows = (header ? lines.slice(1) : lines).filter(Boolean);
  return { header, rows };
}

export function isRealRow(line) {
  const parts = line.split(',');
  // date,value,source[,parser] — source must be non-empty
  return parts.length >= 3 && parts[2].trim() !== '';
}

function purgeFile(file) {
  const csv = readFileSync(file, 'utf8');
  const { rows } = splitRows(csv);
  const real = rows.filter(isRealRow);
  const purged = rows.length - real.length;
  if (!DRY) {
    writeFileSync(file, 'date,value,source,parser\n' + real.map(r => r + '\n').join(''), 'utf8');
  }
  return { real: real.length, purged };
}

// Rebuild sparkline_12m from real history: one point per calendar month
// (last real value in that month), up to the trailing 12 months.
function rebuildSparkline(metricFile, historyCsv) {
  const metric = JSON.parse(readFileSync(metricFile, 'utf8'));
  let points = [];
  if (existsSync(historyCsv)) {
    const { rows } = splitRows(readFileSync(historyCsv, 'utf8'));
    const byMonth = new Map();
    for (const r of rows.filter(isRealRow)) {
      const [date, valueStr] = r.split(',');
      const v = parseFloat(valueStr);
      if (!Number.isFinite(v)) continue;
      byMonth.set(date.slice(0, 7), v); // last write per month wins (rows are chronological)
    }
    points = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1]).slice(-12);
  }
  const before = Array.isArray(metric.sparkline_12m) ? metric.sparkline_12m.length : 0;
  metric.sparkline_12m = points;
  if (points.length < 12) metric._history_state = 'accruing';
  else delete metric._history_state;
  if (!DRY) writeFileSync(metricFile, JSON.stringify(metric, null, 2) + '\n', 'utf8');
  return { before, after: points.length };
}

// ── main ──
if (process.argv[1] && process.argv[1].includes('purge-seed-history')) {
  if (!DRY) mkdirSync(SNAP, { recursive: true });

  let totalPurged = 0, totalReal = 0, files = 0;
  for (const f of readdirSync(HISTORY)) {
    if (!f.endsWith('.csv')) continue;
    const file = join(HISTORY, f);
    if (!DRY) copyFileSync(file, join(SNAP, f));
    const { real, purged } = purgeFile(file);
    totalPurged += purged; totalReal += real; files++;
    if (purged > 0 || real === 0) {
      console.log(`  ${f.padEnd(36)} kept ${String(real).padStart(5)} · purged ${purged}`);
    }
  }
  console.log(`\nHistory: ${files} files · ${totalReal} real rows kept · ${totalPurged} seed rows purged`);
  if (!DRY) console.log(`Pre-purge snapshot: ${SNAP}`);

  // Sparklines for every metric JSON
  let rebuilt = 0, accruing = 0;
  function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!name.name.endsWith('.json')) continue;
      const id = name.name.replace('.json', '');
      const r = rebuildSparkline(p, join(HISTORY, `${id}.csv`));
      rebuilt++;
      if (r.after < 12) accruing++;
    }
  }
  walk(METRICS);
  console.log(`Sparklines rebuilt from real history: ${rebuilt} metrics · ${accruing} now "accruing" (<12 real months)`);
  if (DRY) console.log('\n(dry run — nothing written)');
}
