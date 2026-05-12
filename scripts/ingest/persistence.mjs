// Read/write metric JSON files. Atomic writes (temp file + rename).
// History accumulator: appends to data/history/{metric_id}.csv (date,value).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');

mkdirSync(HISTORY, { recursive: true });

// ──────────────────────────────────────────────────────────────
// Build an in-memory map of metric_id → file path, walking data/
// ──────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['snapshots', 'manual-overrides', 'self-heal-reports', 'history']);
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && name !== 'manifest.json' && !name.startsWith('sectors') && name !== 'parser-health.json') out.push(p);
  }
  return out;
}

let _index = null;
export function metricIndex() {
  if (_index) return _index;
  _index = new Map();
  for (const file of walk(DATA)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.metric_id) _index.set(data.metric_id, file);
    } catch {}
  }
  return _index;
}

// ──────────────────────────────────────────────────────────────
// Read / write
// ──────────────────────────────────────────────────────────────
export function readMetric(metric_id) {
  const file = metricIndex().get(metric_id);
  if (!file) throw new Error(`metric not found: ${metric_id}`);
  return { data: JSON.parse(readFileSync(file, 'utf8')), file };
}

export function writeMetric(file, data, { dryRun = false } = {}) {
  const json = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) return { written: false, file };
  const tmp = file + '.tmp';
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, file);
  return { written: true, file };
}

// ──────────────────────────────────────────────────────────────
// History — append to CSV. Idempotent: skip if same date already present.
// ──────────────────────────────────────────────────────────────
function historyFile(metric_id) {
  return join(HISTORY, `${metric_id}.csv`);
}

export function appendHistory(metric_id, value, as_of, { dryRun = false, source = '', parser_id = '' } = {}) {
  const file = historyFile(metric_id);
  const dateKey = as_of.slice(0, 10);
  // Sanitize source for CSV (no commas, no newlines)
  const sourceCol = String(source || '').replace(/[,\n\r]/g, ' ').slice(0, 200);
  const parserCol = String(parser_id || '').replace(/[,\n\r]/g, ' ').slice(0, 80);
  if (existsSync(file)) {
    const last = readFileSync(file, 'utf8').trim().split('\n').slice(-1)[0];
    if (last && last.startsWith(dateKey + ',')) return { appended: false, reason: 'already_present' };
  } else if (!dryRun) {
    // Extended schema (backward-compatible · old rows just have 2 cols)
    writeFileSync(file, 'date,value,source,parser\n', 'utf8');
  }
  if (dryRun) return { appended: false, reason: 'dry_run' };
  appendFileSync(file, `${dateKey},${value},${sourceCol},${parserCol}\n`, 'utf8');
  return { appended: true, file };
}

// ──────────────────────────────────────────────────────────────
// Apply ingest result to a metric — update value, last_verified_at, sparkline rotation
// ──────────────────────────────────────────────────────────────
export function applyIngest(metric_id, ingestResult, { dryRun = false } = {}) {
  const { data, file } = readMetric(metric_id);

  // Update value + as_of + last_verified_at + verification_state
  data.value = ingestResult.value;
  if (ingestResult.as_of) data.as_of = ingestResult.as_of;
  data.last_verified_at = ingestResult.last_verified_at || new Date().toISOString();
  data.verification_state = ingestResult.verification_state;

  // Rotate sparkline_12m — push new value, drop oldest if at 12.
  // (Real Phase 8 logic: aggregate to month-end. For Phase 2: simple rotation.)
  if (Array.isArray(data.sparkline_12m) && typeof ingestResult.value === 'number') {
    const next = data.sparkline_12m.concat(ingestResult.value);
    data.sparkline_12m = next.slice(Math.max(0, next.length - 12));
  }

  // If trends were recomputed, update them
  if (ingestResult.mom_pct !== undefined) data.mom_pct = ingestResult.mom_pct;
  if (ingestResult.yoy_pct !== undefined) data.yoy_pct = ingestResult.yoy_pct;
  if (ingestResult.deviation_from_baseline_pct !== undefined) {
    data.deviation_from_baseline_pct = ingestResult.deviation_from_baseline_pct;
  }
  if (ingestResult.status !== undefined) data.status = ingestResult.status;

  // Persist
  return writeMetric(file, data, { dryRun });
}

// ──────────────────────────────────────────────────────────────
// List all metrics matching a filter (cadence, parser, section)
// ──────────────────────────────────────────────────────────────
export function listMetrics(filter = {}) {
  const out = [];
  for (const [id, file] of metricIndex()) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (filter.section && data.section !== filter.section) continue;
    if (filter.cadence && data.source_primary?.frequency !== filter.cadence) continue;
    if (filter.parser_pattern && !data.source_primary?.parser?.startsWith(filter.parser_pattern)) continue;
    out.push({ metric_id: id, file, data });
  }
  return out;
}
