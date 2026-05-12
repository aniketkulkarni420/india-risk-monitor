#!/usr/bin/env node
// Loop runner for the India self-hosted runner. Iterates over the list of
// metrics that need India IP, invoking `node scripts/ingest.mjs --live --metric=X`
// for each.
//
// Tier S optimizations (2026-05-12):
//   - Parallel execution in chunks of CONCURRENCY (default 4)
//   - Skip-if-fresh: metric younger than (cadence_days/2) is skipped
//   - Continue-on-failure so one bad metric doesn't block others
//   - Always exit 0 so workflow proceeds to validate + commit

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const METRICS = [
  'wacr_repo_spread',
  'pol_demand',
  'air_pax',
  'india_port_dwell_time',
  'eway_bills',
  'fastag_toll',
  'rail_freight',
  'port_cargo',
  'cement_dispatches',
  'upi_value',
  'india_crude_basket',
  'naukri_jobspeak',
  'fno_oi_buildup',
  'block_deals_notional',
  'fpi_debt_flows'
];

const CONCURRENCY = parseInt(process.env.INGEST_CONCURRENCY || '4', 10);
const FORCE = process.argv.includes('--force');

// Cadence-days lookup (approximate). When metric.last_verified_at is younger
// than (cadence/2) AND --force is not set, we skip to save runner time.
const CADENCE_DAYS = {
  wacr_repo_spread: 1,
  pol_demand: 30,
  air_pax: 30,
  india_port_dwell_time: 90,
  eway_bills: 30,
  fastag_toll: 30,
  rail_freight: 30,
  port_cargo: 30,
  cement_dispatches: 30,
  upi_value: 30,
  india_crude_basket: 1,
  naukri_jobspeak: 30,
  fno_oi_buildup: 1,
  block_deals_notional: 1,
  fpi_debt_flows: 1
};

function findMetricFile(metric_id) {
  // Look in common dirs
  for (const sub of ['economy', 'flows', 'macro', 'freight', 'sectors', 'market']) {
    const p = join(ROOT, 'data', 'metrics', sub, `${metric_id}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

function shouldSkip(metric_id) {
  if (FORCE) return false;
  const f = findMetricFile(metric_id);
  if (!f) return false;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const lastV = j.last_verified_at;
    if (!lastV) return false;
    const ageDays = (Date.now() - new Date(lastV).getTime()) / 86400000;
    const halfCadence = (CADENCE_DAYS[metric_id] || 7) / 2;
    return ageDays < halfCadence;
  } catch { return false; }
}

async function ingestOne(metric_id) {
  if (shouldSkip(metric_id)) {
    return { metric_id, status: 'skipped', reason: 'fresh' };
  }
  const t0 = Date.now();
  const r = spawnSync(
    'npm',
    ['run', 'ingest', '--', '--live', `--metric=${metric_id}`],
    { stdio: 'inherit', shell: true }
  );
  const tookSec = ((Date.now() - t0) / 1000).toFixed(1);
  return {
    metric_id,
    status: r.status === 0 ? 'ok' : 'failed',
    exit: r.status,
    tookSec
  };
}

async function runChunked(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    console.log(`\n=== Chunk ${Math.floor(i / concurrency) + 1} of ${Math.ceil(items.length / concurrency)} · ${chunk.join(', ')} ===`);
    const out = await Promise.allSettled(chunk.map(fn));
    for (const r of out) results.push(r.status === 'fulfilled' ? r.value : { status: 'rejected', error: String(r.reason) });
  }
  return results;
}

const startMs = Date.now();
const results = await runChunked(METRICS, CONCURRENCY, ingestOne);
const totalMin = ((Date.now() - startMs) / 60000).toFixed(1);

const ok = results.filter(r => r.status === 'ok').length;
const failed = results.filter(r => r.status === 'failed' || r.status === 'rejected').length;
const skipped = results.filter(r => r.status === 'skipped').length;

console.log();
console.log('================================');
console.log(`India-loop done · ${ok} ok · ${skipped} skipped (fresh) · ${failed} failed · ${totalMin} min (concurrency=${CONCURRENCY})`);
console.log('================================');
process.exit(0);
