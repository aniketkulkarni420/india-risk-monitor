#!/usr/bin/env node
// Orchestrator · Phase 2 ingest pipeline
//
// Usage:
//   node scripts/ingest.mjs                     # run all daily metrics (mock mode)
//   node scripts/ingest.mjs --slot=daily_06     # run a specific slot
//   node scripts/ingest.mjs --metric=brent_crude # run a single metric
//   node scripts/ingest.mjs --live              # use real fetchers where registered
//   node scripts/ingest.mjs --dry-run           # simulate without writing
//
// Default mode is MOCK. Switch to --live once individual parsers are reviewed
// and registered in scripts/ingest/registry.mjs.

import { readMetric, applyIngest, appendHistory, listMetrics } from './ingest/persistence.mjs';
import { resolve, listRealParsers } from './ingest/registry.mjs';
import { verify } from './ingest/crosscheck.mjs';
import { SLOTS, ALL_DAILY, ALL_EVERY, COMPOSITES, slotFor } from './ingest/schedule.mjs';
import { info, warn, error } from './ingest/logger.mjs';

const ARGS = parseArgs(process.argv.slice(2));

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function parseArgs(argv) {
  const out = { live: false, dryRun: false };
  for (const a of argv) {
    if (a === '--live') out.live = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--slot=')) out.slot = a.slice(7);
    else if (a.startsWith('--metric=')) out.metric = a.slice(9);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Determine which metric_ids to ingest in this run
// ──────────────────────────────────────────────────────────────
function resolveTargets() {
  if (ARGS.metric) return [ARGS.metric];
  if (ARGS.slot === 'all') return ALL_EVERY;            // every metric, every cadence
  if (ARGS.slot === 'all_daily') return ALL_DAILY;      // daily-cadence subset only
  if (ARGS.slot) return slotFor(ARGS.slot).metric_ids;
  // Default: all daily
  return ALL_DAILY;
}

// ──────────────────────────────────────────────────────────────
// Ingest one metric — fetch primary, fetch crosschecks, verify, persist
// ──────────────────────────────────────────────────────────────
async function ingestOne(metric_id) {
  const start = Date.now();
  try {
    const { data: metric } = readMetric(metric_id);
    const parser_id = metric.source_primary?.parser;
    if (!parser_id) throw new Error('source_primary.parser missing');

    const { mode, parser } = resolve(parser_id, { live: ARGS.live });

    // Primary fetch
    const primary = await parser.fetchPrimary(metric);

    // Cross-checks (sequential — keeps polite to sources)
    const crosschecks = [];
    for (let i = 0; i < (metric.source_crosscheck?.length || 0); i++) {
      try {
        const cc = await parser.fetchCrosscheck(metric, i, primary.value);
        crosschecks.push(cc);
      } catch (e) {
        warn('crosscheck_fail', { metric_id, idx: i, err: e.message });
      }
    }

    // Verification
    const verdict = verify(primary, crosschecks);

    // Build ingest result
    const result = {
      value: verdict.value,
      as_of: primary.as_of,
      last_verified_at: new Date().toISOString(),
      verification_state: verdict.verification_state
      // mom_pct / yoy_pct trend recompute deferred to Phase 8 backfill.
      // Phase 2 leaves those values intact.
    };

    // Persist + history
    const writeRes = applyIngest(metric_id, result, { dryRun: ARGS.dryRun });
    const histRes  = appendHistory(metric_id, verdict.value, primary.as_of, { dryRun: ARGS.dryRun });

    const took = Date.now() - start;
    info('ingest_ok', {
      metric_id, mode, parser_id, took_ms: took,
      verification_state: verdict.verification_state,
      divergence_pct: verdict.divergence_pct,
      written: writeRes.written, history: histRes.appended
    });

    return {
      ok: true, metric_id, mode, parser_id,
      value: verdict.value,
      verification_state: verdict.verification_state,
      divergence_pct: verdict.divergence_pct,
      took_ms: took
    };
  } catch (e) {
    const took = Date.now() - start;
    error('ingest_fail', { metric_id, err: e.message, took_ms: took });
    return { ok: false, metric_id, err: e.message, took_ms: took };
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
const targets = resolveTargets();

console.log();
console.log(BOLD('IRM ingest · Phase 2'));
console.log(DIM(`mode: ${ARGS.live ? 'LIVE' : 'MOCK'}${ARGS.dryRun ? ' · DRY RUN' : ''}  ·  targets: ${targets.length}  ·  real parsers registered: ${listRealParsers().length}`));
if (ARGS.slot && ARGS.slot !== 'all') console.log(DIM(`slot: ${ARGS.slot} — ${slotFor(ARGS.slot).description}`));
else if (ARGS.slot === 'all') console.log(DIM('slot: all daily-cadence metrics'));
console.log();

const results = [];
for (const metric_id of targets) {
  const res = await ingestOne(metric_id);
  results.push(res);
  const tag = !res.ok ? RED('✗') :
    res.verification_state === 'verified' ? GREEN('✓') :
    res.verification_state === 'crosscheck_pending' ? YELLOW('⚠') : DIM('·');
  const meta = res.ok
    ? `${DIM(res.mode)} ${DIM(res.parser_id)} → value ${BOLD(String(res.value))} · ${res.verification_state}${res.divergence_pct != null ? ` · div ${res.divergence_pct}%` : ''} · ${res.took_ms}ms`
    : RED(res.err);
  console.log(`  ${tag} ${metric_id.padEnd(30)} ${meta}`);
}

// Summary
const ok = results.filter(r => r.ok).length;
const verified = results.filter(r => r.verification_state === 'verified').length;
const pending = results.filter(r => r.verification_state === 'crosscheck_pending').length;
const failed = results.filter(r => !r.ok).length;

console.log();
console.log(BOLD(
  `Result: ${GREEN(verified + ' verified')}, ${pending ? YELLOW(pending + ' crosscheck_pending') : '0 crosscheck_pending'}, ${failed ? RED(failed + ' failed') : '0 failed'}`
));
if (ARGS.dryRun) console.log(YELLOW('DRY RUN — no files written.'));
if (!ARGS.live) console.log(DIM('Mock mode — no network. Re-run with --live once parsers are registered.'));
console.log();

process.exit(failed ? 1 : 0);
