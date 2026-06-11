#!/usr/bin/env node
// C4 · 2026-06-11 · Backfill REAL history from free official/archive feeds,
// with AUTOMATED verification (no manual review needed).
//
// Sources:
//   · Yahoo Finance chart API (5y daily) — market metrics
//   · OEA ICI XLSX (full monthly series since 2011) — eight_core_industries
//
// Every backfilled series must pass ALL checks before it is written:
//   1. OVERLAP    — where backfill dates overlap existing live-ingested rows,
//                   median |diff| must be < 2% (proves same units & series)
//   2. CURRENT    — newest backfill point within 8% of the metric's live value
//                   (gap allows a few days of market drift)
//   3. UNIT-SHIFT — max/min ratio of the series within sane bounds
//   4. DATES      — strictly increasing, no future dates
// Any failure → series quarantined to data/self-heal-reports/ and skipped.
//
// Rows are tagged `backfill:<source>` so they count as real, auditable rows.
//
// Usage: node scripts/backfill-real-history.mjs [--dry-run]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitRows, isRealRow } from './purge-seed-history.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HISTORY = join(ROOT, 'data', 'history');
const REPORTS = join(ROOT, 'data', 'self-heal-reports');
const DRY = process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Backfill/1.0';

const YAHOO = [
  { id: 'nifty_50', symbol: '^NSEI' },
  { id: 'bank_nifty', symbol: '^NSEBANK' },
  { id: 'inr_usd', symbol: 'INR=X' },
  { id: 'dxy', symbol: 'DX-Y.NYB' },
  { id: 'gold_usd', symbol: 'GC=F' },
  { id: 'brent_crude', symbol: 'BZ=F' },
  { id: 'india_vix', symbol: '^INDIAVIX' }
];

function readMetricValue(id) {
  for (const sec of ['market', 'macro', 'freight', 'flows', 'economy']) {
    const p = join(ROOT, 'data', 'metrics', sec, `${id}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  return null;
}

function existingRealRows(id) {
  const f = join(HISTORY, `${id}.csv`);
  if (!existsSync(f)) return new Map();
  const { rows } = splitRows(readFileSync(f, 'utf8'));
  const map = new Map();
  for (const r of rows.filter(isRealRow)) {
    const [date, v] = r.split(',');
    const n = parseFloat(v);
    if (Number.isFinite(n)) map.set(date, n);
  }
  return map;
}

// ── automated verification ──
function verifySeries(id, series, liveValue, existing) {
  const reasons = [];

  // 4 · dates sane
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 1; i < series.length; i++) {
    if (series[i].date <= series[i - 1].date) { reasons.push(`dates not increasing at ${series[i].date}`); break; }
  }
  if (series.length && series[series.length - 1].date > today) reasons.push('future-dated points');

  // 3 · unit shift — only meaningful for LEVEL series (prices, indices).
  // Growth-rate/spread series legitimately cross zero, making max/min ratio
  // unbounded (ICI growth spans −0.02%→+12.6% = ratio 626× yet is correct).
  const vals = series.map(p => Math.abs(p.value)).filter(v => v > 0);
  if (vals.length > 2 && Math.min(...vals) > 5) {
    const ratio = Math.max(...vals) / Math.min(...vals);
    if (ratio > 50) reasons.push(`unit-shift suspicion: max/min ratio ${ratio.toFixed(0)}×`);
  }

  // 1 · overlap vs live-ingested rows
  const diffs = [];
  for (const p of series) {
    if (existing.has(p.date)) {
      const live = existing.get(p.date);
      if (live !== 0) diffs.push(Math.abs((p.value - live) / live) * 100);
    }
  }
  if (diffs.length >= 3) {
    diffs.sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];
    if (median > 2) reasons.push(`overlap mismatch: median diff ${median.toFixed(1)}% over ${diffs.length} shared dates`);
  } else if (diffs.length === 0 && existing.size > 0) {
    reasons.push('no overlapping dates with live rows — cannot cross-verify');
  }

  // 2 · endpoint vs current live value
  if (typeof liveValue === 'number' && series.length) {
    const lastV = series[series.length - 1].value;
    const drift = Math.abs((lastV - liveValue) / liveValue) * 100;
    if (drift > 8) reasons.push(`endpoint drift ${drift.toFixed(1)}% vs live value ${liveValue}`);
  }

  return { ok: reasons.length === 0, reasons, overlapChecked: diffs.length };
}

function mergeAndWrite(id, series, sourceTag) {
  const f = join(HISTORY, `${id}.csv`);
  const existing = existsSync(f) ? splitRows(readFileSync(f, 'utf8')).rows.filter(isRealRow) : [];
  const have = new Set(existing.map(r => r.split(',')[0]));
  const newRows = series.filter(p => !have.has(p.date))
    .map(p => `${p.date},${p.value},${sourceTag},backfill`);
  const all = [...existing, ...newRows].sort((a, b) => a.split(',')[0].localeCompare(b.split(',')[0]));
  if (!DRY) writeFileSync(f, 'date,value,source,parser\n' + all.map(r => r + '\n').join(''), 'utf8');
  return newRows.length;
}

async function backfillYahoo({ id, symbol }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`yahoo ${symbol} HTTP ${res.status}`);
  const j = await res.json();
  const r0 = j?.chart?.result?.[0];
  const ts = r0?.timestamp || [];
  const closes = r0?.indicators?.quote?.[0]?.close || [];
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    series.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: +v.toFixed(4) });
  }
  // de-dupe per date (intraday timestamps on last day)
  const byDate = new Map();
  for (const p of series) byDate.set(p.date, p);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function backfillIci() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const XLSX = require('xlsx');
  const home = await fetch('https://eaindustry.nic.in/', { headers: { 'User-Agent': UA } }).then(r => r.text());
  const m = home.match(/href="(eight_core_infra\/Core_Industries_2011_12_\d+\.xlsx)"/i);
  if (!m) throw new Error('ICI XLSX link not found');
  const buf = Buffer.from(await fetch('https://eaindustry.nic.in/' + m[1], { headers: { 'User-Agent': UA } }).then(r => r.arrayBuffer()));
  const wb = XLSX.read(buf, { type: 'buffer' });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['Growth (%)'], { header: 1, raw: false });
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const series = [];
  for (const row of grid) {
    const lm = row && String(row[0] || '').trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
    if (!lm || MONTHS[lm[1]] == null) continue;
    const v = parseFloat(row[1]);
    if (!Number.isFinite(v)) continue;
    const end = new Date(Date.UTC(2000 + parseInt(lm[2], 10), MONTHS[lm[1]] + 1, 0));
    series.push({ date: end.toISOString().slice(0, 10), value: v });
  }
  return series.sort((a, b) => a.date.localeCompare(b.date));
}

// ── main ──
const quarantine = [];
let written = 0;

console.log(DRY ? '── DRY RUN ──' : '── BACKFILL ──');

for (const cfg of YAHOO) {
  try {
    const series = await backfillYahoo(cfg);
    const metric = readMetricValue(cfg.id);
    const existing = existingRealRows(cfg.id);
    const v = verifySeries(cfg.id, series, metric?.value ?? null, existing);
    if (!v.ok) {
      quarantine.push({ id: cfg.id, source: 'yahoo:' + cfg.symbol, points: series.length, reasons: v.reasons });
      console.log(`  ✗ ${cfg.id.padEnd(22)} QUARANTINED — ${v.reasons.join(' · ')}`);
      continue;
    }
    const added = mergeAndWrite(cfg.id, series, `backfill:yahoo ${cfg.symbol}`);
    written += added;
    console.log(`  ✓ ${cfg.id.padEnd(22)} +${added} rows (5y daily) · overlap-verified on ${v.overlapChecked} dates`);
  } catch (e) {
    quarantine.push({ id: cfg.id, source: 'yahoo:' + cfg.symbol, reasons: [e.message] });
    console.log(`  ✗ ${cfg.id.padEnd(22)} FETCH FAIL — ${e.message}`);
  }
}

try {
  const series = await backfillIci();
  const metric = readMetricValue('eight_core_industries');
  const existing = existingRealRows('eight_core_industries');
  const v = verifySeries('eight_core_industries', series, metric?.value ?? null, existing);
  if (!v.ok) {
    quarantine.push({ id: 'eight_core_industries', source: 'oea-ici', points: series.length, reasons: v.reasons });
    console.log(`  ✗ eight_core_industries  QUARANTINED — ${v.reasons.join(' · ')}`);
  } else {
    const added = mergeAndWrite('eight_core_industries', series, 'backfill:oea-ici-xlsx');
    written += added;
    console.log(`  ✓ eight_core_industries  +${added} rows (monthly since 2011) · overlap-verified on ${v.overlapChecked} dates`);
  }
} catch (e) {
  console.log(`  ✗ eight_core_industries  FETCH FAIL — ${e.message}`);
}

if (quarantine.length && !DRY) {
  mkdirSync(REPORTS, { recursive: true });
  const f = join(REPORTS, `backfill-quarantine-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(f, JSON.stringify(quarantine, null, 2) + '\n', 'utf8');
  console.log(`\nQuarantine report: ${f}`);
}
console.log(`\n${written} rows backfilled · ${quarantine.length} series quarantined`);
console.log(DRY ? '(dry run — nothing written)' : 'Run purge-seed-history.mjs sparkline rebuild via: node scripts/purge-seed-history.mjs');
