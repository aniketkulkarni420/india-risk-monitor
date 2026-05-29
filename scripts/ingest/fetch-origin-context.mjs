// Fetch-origin tracking · kills the "cache-masking lie".
//
// THE PROBLEM: fetch-resilient.mjs, when every live attempt fails, serves the
// last cached body with { ok: true, source: 'local_cache' }. The parser then
// returns a value, the metric is stamped verification_state: 'verified' +
// last_verified_at: now — so every freshness monitor (which keys off
// last_verified_at) sees a frozen-from-cache metric as "fresh and green".
// A source can rot for months while the dashboard reports all-clear.
//
// THE FIX: track, per metric-ingest, the *least-live* origin any fetch served.
// AsyncLocalStorage is concurrency-safe across awaits, so parallel metric
// ingests don't cross-contaminate. fetch-resilient calls noteOrigin() on every
// return path; ingest.mjs wraps each parser invocation in runWithOriginTracking
// and reads back the worst origin. Parsers that DON'T use fetch-resilient
// (raw fetch, LLM, NSE JSON) never call noteOrigin → origin stays null →
// treated as genuinely live (correct: those paths fetch live or throw).
//
// "Live" = data actually pulled from the network this run.
// "Stale-origin" = served from a cache/archive (local_cache, wayback,
//                  google_cache) — a real value, but NOT proof of liveness.

import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

// Severity ranking — higher = less live. We keep the MAX (worst) seen.
const ORIGIN_SEVERITY = {
  primary: 0,
  'cf-proxy': 0,
  fetch: 0,
  'fetch-fallback': 0,
  playwright: 0,
  wayback: 2,
  google_cache: 2,
  local_cache: 3
};

// Anything ranked < STALE_ORIGIN_THRESHOLD counts as a genuine live fetch.
const STALE_ORIGIN_THRESHOLD = 2;

export function runWithOriginTracking(fn) {
  return als.run({ worst: null, worstSeverity: -1 }, fn);
}

export function noteOrigin(source) {
  if (!source) return;
  const store = als.getStore();
  if (!store) return;
  const sev = ORIGIN_SEVERITY[source] ?? 0;
  if (sev > store.worstSeverity) {
    store.worstSeverity = sev;
    store.worst = source;
  }
}

// Returns { origin, isLive } for the just-completed tracked run.
//   origin === null  → no fetch-resilient call happened (raw/LLM parser) → live
//   isLive === true  → all served data came from the network this run
export function readOrigin() {
  const store = als.getStore();
  if (!store) return { origin: null, isLive: true };
  if (store.worst === null) return { origin: null, isLive: true };
  return { origin: store.worst, isLive: store.worstSeverity < STALE_ORIGIN_THRESHOLD };
}
