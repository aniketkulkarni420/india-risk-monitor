// Parser health logger · 2026-05-11
// Tracks per-parser success/failure on every CI ingest run.
// Writes to data/parser-health.json:
//
//   { generated_at, summary: {green, amber, red, total},
//     parsers: { metric_id: {
//       last_success_at, last_success_value,
//       last_failure_at, last_failure_reason,
//       consecutive_failures,
//       runs_24h: {success, failure},
//       status: 'green' | 'amber' | 'red'
//     }}}
//
// Status rules:
//   green = success within 1 cadence_days × 1.0
//   amber = no success in 1× to 2× cadence_days · or 1-2 consecutive failures
//   red   = 3+ consecutive failures OR no success in 2× cadence_days
//
// Bundle.mjs reads this and the live dashboard surfaces a "X/70 healthy"
// indicator. CI workflow opens a GitHub issue when any parser hits red.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CADENCE_DAYS } from './freshness-spec.mjs';
import { listOverrides } from './ingest/manual-override.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEALTH_FILE = join(__dirname, '..', 'data', 'parser-health.json');

function loadHealth() {
  if (!existsSync(HEALTH_FILE)) return { parsers: {} };
  try { return JSON.parse(readFileSync(HEALTH_FILE, 'utf8')); }
  catch { return { parsers: {} }; }
}

function classify(p, cadenceDays = 30) {
  const now = Date.now();
  if (!p.last_success_at) return 'red';
  const sinceLastSuccessHrs = (now - new Date(p.last_success_at).getTime()) / 36e5;
  const sinceLastSuccessDays = sinceLastSuccessHrs / 24;
  if (p.consecutive_failures >= 3) return 'red';
  if (sinceLastSuccessDays > cadenceDays * 2) return 'red';
  if (p.consecutive_failures >= 1) return 'amber';
  if (sinceLastSuccessDays > cadenceDays) return 'amber';
  return 'green';
}

// Called per parser-attempt by ingest pipeline.
export function recordSuccess(metricId, value) {
  const h = loadHealth();
  h.parsers[metricId] = h.parsers[metricId] || {};
  const p = h.parsers[metricId];
  p.last_success_at = new Date().toISOString();
  p.last_success_value = value;
  p.consecutive_failures = 0;
  p.status = classify(p, CADENCE_DAYS[metricId]);
  saveHealth(h);
}

export function recordFailure(metricId, reason) {
  const h = loadHealth();
  h.parsers[metricId] = h.parsers[metricId] || {};
  const p = h.parsers[metricId];
  p.last_failure_at = new Date().toISOString();
  p.last_failure_reason = String(reason).slice(0, 240);
  p.consecutive_failures = (p.consecutive_failures || 0) + 1;
  p.status = classify(p, CADENCE_DAYS[metricId]);
  saveHealth(h);
}

function saveHealth(h) {
  // Roll up summary
  const counts = { green: 0, amber: 0, red: 0, total: 0 };
  for (const p of Object.values(h.parsers)) {
    counts.total++;
    counts[p.status || 'red']++;
  }
  h.summary = counts;
  h.generated_at = new Date().toISOString();
  writeFileSync(HEALTH_FILE, JSON.stringify(h, null, 2), 'utf8');
}

// Read-only · for bundle.mjs to surface in app/dist/data.json
export function loadHealthSummary() {
  const h = loadHealth();
  let overrides = [];
  try {
    overrides = listOverrides().map(o => ({
      metric_id: o.metric_id,
      value: o.value, as_of: o.as_of, source_name: o.source_name,
      source_url: o.source_url, expires_at: o.expires_at
    }));
  } catch {}
  return {
    generated_at: h.generated_at,
    summary: h.summary || { green: 0, amber: 0, red: 0, total: 0 },
    red_metrics: Object.entries(h.parsers || {})
      .filter(([id, p]) => p.status === 'red')
      .map(([id, p]) => ({
        id,
        consecutive_failures: p.consecutive_failures,
        last_success_at: p.last_success_at,
        last_failure_reason: p.last_failure_reason
      })),
    manual_overrides: overrides
  };
}
