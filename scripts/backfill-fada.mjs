#!/usr/bin/env node
// Backfill FADA · pulls all monthly PDFs visible on the FADA homepage and
// writes 3+ historical data points per auto segment to history CSV +
// metric.sparkline_12m. Resolves the "data verifying" badges on auto_2w,
// auto_3w, auto_pv, auto_cv, auto_tractor.
//
// Run: node scripts/backfill-fada.mjs [--dry-run]

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');
mkdirSync(HISTORY, { recursive: true });

const FADA_HOME = 'https://fada.in/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Backfill/1.0';
const DRY_RUN = process.argv.includes('--dry-run');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const SEGMENTS = {
  auto_2w:      { aliases: ['Two Wheeler', '2 Wheeler', '2W'],         range: [800_000, 3_000_000] },
  auto_3w:      { aliases: ['Three Wheeler', '3 Wheeler', '3W'],       range: [40_000, 200_000] },
  auto_pv:      { aliases: ['Passenger Vehicle', '4 Wheeler', 'PV'],   range: [200_000, 600_000] },
  auto_cv:      { aliases: ['Commercial Vehicle', 'CV', 'LCV'],        range: [40_000, 200_000] },
  auto_tractor: { aliases: ['Tractor', 'TRAC', 'TRC'],                 range: [30_000, 200_000] }
};

// FADA's CDN discriminates by TLS fingerprint: Node's undici gets a 4KB stub,
// curl gets the full 105KB page. Shelling out to curl is the simplest workaround.
import { execFileSync } from 'node:child_process';
import { writeFileSync as _wf, readFileSync as _rf, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

function curlText(url) {
  const out = execFileSync('curl', [
    '-sS', '--max-time', '30', '-L',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    url
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out;
}

function curlBuffer(url) {
  const tmp = mkdtempSync(join(tmpdir(), 'fada-'));
  const tmpFile = join(tmp, 'pdf.bin');
  execFileSync('curl', [
    '-sS', '--max-time', '60', '-L',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-o', tmpFile, url
  ], { stdio: 'pipe' });
  const buf = _rf(tmpFile);
  try { unlinkSync(tmpFile); } catch {}
  return buf;
}

async function fetchText(url) { return curlText(url); }
async function fetchBuffer(url) { return curlBuffer(url); }

async function pdfToText(buf) {
  const p = new PDFParse({ data: buf });
  try {
    const out = await p.getText();
    return typeof out === 'string' ? out : (out.text ?? out.pages?.map(p => p.text || '').join('\n') ?? '');
  } finally { if (typeof p.destroy === 'function') p.destroy(); }
}

// Discover all month PDFs on FADA homepage. Looks for URLs containing the
// phrase "Vehicle Retail Data" and extracts the month name nearest to it.
async function findAllReleaseUrls() {
  const html = await fetchText(FADA_HOME);
  const urls = new Map();  // dateStr → url
  const monthList = MONTHS.join('|');
  const re = /href=["']([^"']+\.pdf[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = new URL(m[1].replace(/&amp;/g, '&'), FADA_HOME).href;
    const decoded = decodeURIComponent(url);
    if (!/Vehicle\s*Retail/i.test(decoded)) continue;
    // Look for "<MONTH> <YEAR>" anywhere in the decoded URL
    const re2 = new RegExp(`(${monthList})\\s+(\\d{4})`, 'gi');
    let dm, found = null;
    while ((dm = re2.exec(decoded)) !== null) {
      // Take the LAST month-year occurrence in the URL · in "FY 2026 and March 2026 Vehicle..." we want March 2026
      found = dm;
    }
    if (found) {
      const monthIdx = MONTHS.findIndex(x => x.toLowerCase() === found[1].toLowerCase());
      if (monthIdx >= 0) {
        const year = parseInt(found[2], 10);
        const lastDay = new Date(year, monthIdx + 1, 0);
        const dateStr = lastDay.toISOString().slice(0, 10);
        if (!urls.has(dateStr)) urls.set(dateStr, url);
      }
    }
  }
  return Array.from(urls.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function extractSegmentValue(pdfText, aliases, range) {
  for (const alias of aliases) {
    const re = new RegExp(`(?:^|\\n|\\s)${alias.replace(/\s+/g, '\\s*')}[\\s\\S]{0,40}?([1-9][\\d,]{2,9})`, 'i');
    const m = pdfText.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (Number.isFinite(n) && n >= range[0] && n <= range[1]) return n;
    }
  }
  return null;
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
console.log(bold('\nFADA backfill\n'));

const releases = await findAllReleaseUrls();
console.log(`  Discovered ${releases.length} monthly PDFs on FADA homepage`);
releases.forEach(([d, u]) => console.log(dim(`    · ${d} · ${u.slice(0, 90)}...`)));
console.log();

if (releases.length === 0) {
  console.log(red('No PDFs discovered. FADA homepage may have changed.'));
  process.exit(1);
}

// Per-segment series builder
const seriesBySegment = {};
for (const id of Object.keys(SEGMENTS)) seriesBySegment[id] = [];

for (const [dateStr, url] of releases) {
  console.log(`  Parsing ${dateStr} ...`);
  let text;
  try {
    const buf = await fetchBuffer(url);
    text = await pdfToText(buf);
  } catch (e) {
    console.log(red(`    ✗ fetch/parse failed: ${e.message}`));
    continue;
  }
  for (const [id, cfg] of Object.entries(SEGMENTS)) {
    const v = extractSegmentValue(text, cfg.aliases, cfg.range);
    if (v != null) {
      seriesBySegment[id].push({ date: dateStr, value: v });
      console.log(green(`    ✓ ${id.padEnd(15)} = ${v.toLocaleString()}`));
    } else {
      console.log(yellow(`    ⚠ ${id.padEnd(15)} not found`));
    }
  }
}

// Update each segment metric
console.log();
console.log(bold('Writing history CSVs + sparkline_12m updates'));
for (const [id, series] of Object.entries(seriesBySegment)) {
  if (series.length < 2) {
    console.log(yellow(`  ⚠ ${id} : only ${series.length} point(s), skipping`));
    continue;
  }
  series.sort((a, b) => a.date.localeCompare(b.date));

  // History CSV
  const csv = 'date,value\n' + series.map(p => `${p.date},${p.value}`).join('\n') + '\n';
  const csvPath = join(HISTORY, `${id}.csv`);
  if (!DRY_RUN) writeFileSync(csvPath, csv, 'utf8');

  // Update metric JSON sparkline
  const metricPath = ['economy'].map(s => join(DATA, 'metrics', s, `${id}.json`)).find(p => existsSync(p));
  if (metricPath) {
    const m = JSON.parse(readFileSync(metricPath, 'utf8'));
    m.sparkline_12m = series.slice(-12).map(p => p.value);
    if (series.length >= 2) {
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      if (prev.value !== 0) {
        m.mom_pct = +(((last.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(2);
      }
      m.value = last.value;
      m.as_of = new Date(last.date + 'T17:30:00+05:30').toISOString();
    }
    if (!DRY_RUN) writeFileSync(metricPath, JSON.stringify(m, null, 2) + '\n', 'utf8');
  }
  console.log(green(`  ✓ ${id} : ${series.length} points written · ${csvPath.replace(ROOT, '')}`));
}

console.log();
console.log(DRY_RUN ? yellow('DRY RUN · no files written.') : green('Done.'));
