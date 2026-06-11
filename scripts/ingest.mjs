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
import { runWithOriginTracking, readOrigin } from './ingest/fetch-origin-context.mjs';
import { resolve, listRealParsers } from './ingest/registry.mjs';
import { recordSuccess, recordFailure } from './parser-health.mjs';
import { verify } from './ingest/crosscheck.mjs';
import { lookupOverride } from './ingest/manual-override.mjs';
import { SLOTS, ALL_DAILY, ALL_EVERY, COMPOSITES, slotFor } from './ingest/schedule.mjs';
import { info, warn, error } from './ingest/logger.mjs';
import { closeBrowser } from './ingest/browser-pool.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tiny .env loader (zero deps) — local development convenience.
// Pulls KEY=value pairs from .env into process.env. In CI, secrets come from
// GitHub Actions env: block instead.
(function loadDotEnv() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = join(here, '..', '.env');
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch {}
})();

const _SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(_SCRIPT_DIR, '..', 'data', 'history');

// Recompute mom_pct / yoy_pct from the metric's history CSV. If the CSV doesn't
// have a value ~30 days back / ~365 days back (within a tolerance window), the
// corresponding trend is left undefined so applyIngest preserves the current
// value rather than zeroing it out. As history accumulates, both fill in.
function computeTrendsFromHistory(metric_id, currentValue, currentAsOfIso) {
  const file = join(HISTORY_DIR, `${metric_id}.csv`);
  if (!existsSync(file)) return {};
  let rows;
  try {
    rows = readFileSync(file, 'utf8').trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(r => r.length >= 2 && !Number.isNaN(parseFloat(r[1])))
      .map(r => ({ date: new Date(r[0] + 'T00:00:00Z'), value: parseFloat(r[1]) }))
      .sort((a, b) => a.date - b.date);
  } catch { return {}; }
  if (rows.length < 2) return {};
  const now = new Date(currentAsOfIso || rows[rows.length - 1].date);
  const targetMoM = now.getTime() - 30 * 24 * 3600 * 1000;
  const targetYoY = now.getTime() - 365 * 24 * 3600 * 1000;

  // Find row closest to target within tolerance window
  function nearest(target, toleranceDays) {
    const tol = toleranceDays * 24 * 3600 * 1000;
    let best = null, bestDelta = Infinity;
    for (const r of rows) {
      const d = Math.abs(r.date.getTime() - target);
      if (d < bestDelta && d <= tol) { best = r; bestDelta = d; }
    }
    return best;
  }
  const momRow = nearest(targetMoM, 14);   // ±2 weeks for MoM
  const yoyRow = nearest(targetYoY, 45);   // ±~1.5 months for YoY

  const out = {};
  if (momRow && momRow.value !== 0) out.mom_pct = +(((currentValue - momRow.value) / momRow.value) * 100).toFixed(2);
  if (yoyRow && yoyRow.value !== 0) out.yoy_pct = +(((currentValue - yoyRow.value) / yoyRow.value) * 100).toFixed(2);
  return out;
}

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

    // Layer 0: manual override · highest priority. If present + valid + not expired,
    // skip the parser entirely. Health still recorded so we can see when underlying
    // source recovers.
    const override = lookupOverride(metric_id);
    if (override && override.ok) {
      const cadence = (metric.as_of_period || metric.source_primary?.frequency || '').toLowerCase();
      const isDailyish = ['live', '24h', 'daily', 'live (15-min)'].some(c => cadence.includes(c));
      const trends = isDailyish ? computeTrendsFromHistory(metric_id, override.value, override.as_of) : {};

      const result = {
        value: override.value,
        as_of: override.as_of,
        last_verified_at: new Date().toISOString(),
        verification_state: 'manual_override',
        data_origin: 'manual_override',
        origin_is_live: true,   // an authoritative human-set value counts as live
        ...trends
      };
      const writeRes = applyIngest(metric_id, result, { dryRun: ARGS.dryRun });
      const histRes  = appendHistory(metric_id, override.value, override.as_of, { dryRun: ARGS.dryRun, source: 'manual-override', parser_id: 'manual:override' });
      const took = Date.now() - start;
      info('ingest_override', {
        metric_id, parser_id, took_ms: took,
        source: override.source_name, expires_at: override.expires_at,
        written: writeRes.written, history: histRes.appended
      });
      if (!ARGS.dryRun) recordSuccess(metric_id, override.value);
      return {
        ok: true, metric_id, mode: 'override', parser_id,
        value: override.value, verification_state: 'manual_override',
        override_source: override.source_name, took_ms: took
      };
    }
    if (override && override.error) {
      warn('override_invalid', { metric_id, file: override.file, reason: override.error });
    }

    const { mode, parser } = resolve(parser_id, { live: ARGS.live });

    // In live mode, skip metrics without a registered real parser — don't silently mock
    if (mode === 'unregistered') {
      info('ingest_skip_unregistered', { metric_id, parser_id });
      return { ok: true, skipped: true, metric_id, mode, parser_id, reason: 'no live parser registered' };
    }

    // Primary fetch — wrapped in origin tracking so we can tell whether the
    // value came from a genuine live fetch or from a stale cache/archive
    // fallback (fetch-resilient's local_cache/wayback). Untracked parsers
    // (raw fetch / LLM / NSE JSON) report no origin → treated as live.
    let fetchOrigin = { origin: null, isLive: true };
    const primary = await runWithOriginTracking(async () => {
      const p = await parser.fetchPrimary(metric);
      fetchOrigin = readOrigin();
      return p;
    });

    // Final vintage guard (covers non-tiered parsers; tiered_v1 also rejects
    // per-tier). Never stamp "verified" on data older than its publication lag.
    {
      const { checkVintage } = await import('./ingest/observability.mjs');
      const v = checkVintage(metric, primary.as_of);
      if (!v.ok) {
        throw new Error(`OLD DATA rejected: as_of ${String(primary.as_of).slice(0, 10)} is ${v.ageDays}d old (> ${v.allowDays}d allowance for ${v.cadence}) — refusing to verify stale release`);
      }
    }

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

    // Honesty stamp: how many INDEPENDENT sources actually confirmed this value?
    // Most parsers' fetchCrosscheck is a stub that echoes the primary back
    // (parse_meta.source === 'pending' / name '*-crosscheck-pending') — that is
    // self-confirmation, not verification. Count only real ones. The bundle
    // demotes "verified" → "single_source" display when this is < 2.
    const realCrosschecks = crosschecks.filter(c =>
      c && c.parse_meta && c.parse_meta.source !== 'pending' &&
      !/crosscheck-pending/.test(String(c.source_name || ''))
    ).length;

    // Verification
    const verdict = verify(primary, crosschecks);

    // Recompute trends from history CSV — but ONLY for daily/live cadence metrics.
    // Monthly/weekly metrics get the same value reported many days in a row
    // (because the underlying release only changes once a month/week), so a
    // naive 30-day lookback gives a misleading "MoM". For those, leave existing
    // mom_pct/yoy_pct intact — they're correct relative to the prior release.
    const cadence = (metric.as_of_period || metric.source_primary?.frequency || '').toLowerCase();
    const isDailyish = ['live', '24h', 'daily', 'live (15-min)'].some(c => cadence.includes(c));
    const trends = isDailyish ? computeTrendsFromHistory(metric_id, verdict.value, primary.as_of) : {};

    // Build ingest result
    const result = {
      value: verdict.value,
      as_of: primary.as_of,
      last_verified_at: new Date().toISOString(),
      verification_state: verdict.verification_state,
      // Liveness provenance (kills the cache-masking lie · see fetch-origin-context.mjs)
      data_origin: fetchOrigin.origin || 'live',
      origin_is_live: fetchOrigin.isLive,
      // Verification honesty: 1 primary + N real (non-stub) crosschecks
      extra: { ...(primary.extra && typeof primary.extra === 'object' ? primary.extra : {}), _source_count_actual: 1 + realCrosschecks },
      ...trends,
      // (parser `extra` fields are merged into the honesty-stamped extra above —
      // a second `extra:` key here would silently override it)
    };

    // Persist + history
    const writeRes = applyIngest(metric_id, result, { dryRun: ARGS.dryRun });
    const histRes  = appendHistory(metric_id, verdict.value, primary.as_of, { dryRun: ARGS.dryRun, source: (primary.parse_meta?.source || primary.parse_meta?.url || ''), parser_id });

    const took = Date.now() - start;
    info('ingest_ok', {
      metric_id, mode, parser_id, took_ms: took,
      verification_state: verdict.verification_state,
      divergence_pct: verdict.divergence_pct,
      written: writeRes.written, history: histRes.appended
    });

    // Health log · success
    if (!ARGS.dryRun) recordSuccess(metric_id, verdict.value);

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
    // Health log · failure
    if (!ARGS.dryRun) recordFailure(metric_id, e.message);
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
    res.skipped ? DIM('—') :
    res.verification_state === 'manual_override' ? YELLOW('⚑') :
    res.verification_state === 'verified' ? GREEN('✓') :
    res.verification_state === 'crosscheck_pending' ? YELLOW('⚠') : DIM('·');
  const meta = !res.ok ? RED(res.err)
    : res.skipped ? DIM(`${res.parser_id} · ${res.reason}`)
    : res.mode === 'override' ? `${YELLOW('OVERRIDE')} ${DIM(res.override_source)} → value ${BOLD(String(res.value))} · ${res.took_ms}ms`
    : `${DIM(res.mode)} ${DIM(res.parser_id)} → value ${BOLD(String(res.value))} · ${res.verification_state}${res.divergence_pct != null ? ` · div ${res.divergence_pct}%` : ''} · ${res.took_ms}ms`;
  console.log(`  ${tag} ${metric_id.padEnd(30)} ${meta}`);
}

// Summary
const ok = results.filter(r => r.ok && !r.skipped).length;
const skipped = results.filter(r => r.skipped).length;
const verified = results.filter(r => r.verification_state === 'verified').length;
const pending = results.filter(r => r.verification_state === 'crosscheck_pending').length;
const failed = results.filter(r => !r.ok).length;

console.log();
console.log(BOLD(
  `Result: ${GREEN(verified + ' verified')}, ${pending ? YELLOW(pending + ' crosscheck_pending') : '0 crosscheck_pending'}, ${skipped ? DIM(skipped + ' skipped (no live parser)') : '0 skipped'}, ${failed ? RED(failed + ' failed') : '0 failed'}`
));
if (ARGS.dryRun) console.log(YELLOW('DRY RUN — no files written.'));
if (!ARGS.live) console.log(DIM('Mock mode — no network. Re-run with --live once parsers are registered.'));
console.log();

// Explicit shared-browser shutdown before exit. The browser pool no longer
// auto-closes on `beforeExit` (that fired mid-run and killed in-flight parsers).
await closeBrowser().catch(() => {});
process.exit(failed ? 1 : 0);
