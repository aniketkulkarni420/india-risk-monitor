// Observability helpers: source cooldown, LLM telemetry, anomaly detection.
// Added 2026-05-12 as part of Tier A reliability batch.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const COOLDOWN_FILE = join(ROOT, 'data', 'source-cooldown.json');
const LLM_TELEMETRY_FILE = join(ROOT, 'data', 'llm-telemetry.json');
const TIER_STATS_FILE = join(ROOT, 'data', 'tier-stats.json');

// ──────────────────────────────────────────────────────────────
// Per-tier outcome stats · powers the self-improvement loop.
// Records, per (metric_id → parser_id), cumulative attempts/successes plus a
// rolling window of recent outcomes. optimize-reliability.mjs reads this to
// auto-reorder tier_chains (promote reliable tiers) and quarantine dead ones.
// ──────────────────────────────────────────────────────────────
const TIER_RECENT_WINDOW = 30;  // keep last 30 outcomes per tier

function loadTierStats() {
  if (!existsSync(TIER_STATS_FILE)) return {};
  try { return JSON.parse(readFileSync(TIER_STATS_FILE, 'utf8')); } catch { return {}; }
}
function saveTierStats(s) {
  try { writeFileSync(TIER_STATS_FILE, JSON.stringify(s, null, 2)); } catch {}
}

export function recordTierOutcome(metric_id, parser_id, success) {
  if (!metric_id || !parser_id) return;
  const s = loadTierStats();
  const m = s[metric_id] || (s[metric_id] = {});
  const t = m[parser_id] || (m[parser_id] = { attempts: 0, successes: 0, recent: [] });
  t.attempts++;
  if (success) { t.successes++; t.last_success_at = new Date().toISOString(); }
  else { t.last_failure_at = new Date().toISOString(); }
  t.recent.push(success ? 1 : 0);
  if (t.recent.length > TIER_RECENT_WINDOW) t.recent = t.recent.slice(-TIER_RECENT_WINDOW);
  t.success_rate = +(t.successes / t.attempts).toFixed(3);
  saveTierStats(s);
}

export function getTierStats() { return loadTierStats(); }

// ──────────────────────────────────────────────────────────────
// Data-vintage guard · rejects parser results whose as_of is older than any
// plausible publication lag for the metric's cadence. Stops the failure class
// observed 2026-06-10: fastag_toll's LLM tier kept re-extracting a Jan-2024
// figure from a stale page and stamping it "verified" for 2.4 years.
// A rejected result = tier failure → next tier tries → or ingest fails
// HONESTLY (stale badge + parser-health red + self-heal) instead of lying.
// ──────────────────────────────────────────────────────────────
const VINTAGE_ALLOWANCE_DAYS = {
  'Live': 7, 'Daily': 7, 'Weekly': 21, 'Fortnightly': 35,
  'Monthly': 75, 'Quarterly': 160, 'Per release': 270
};
const VINTAGE_DEFAULT_DAYS = 75;

export function checkVintage(metric, asOfIso) {
  if (!asOfIso) return { ok: true };                       // no as_of claimed — other gates handle
  const freq = metric?.source_primary?.frequency || 'Daily';
  const allow = VINTAGE_ALLOWANCE_DAYS[freq] ?? VINTAGE_DEFAULT_DAYS;
  const ageDays = (Date.now() - new Date(asOfIso).getTime()) / 86400000;
  if (!Number.isFinite(ageDays)) return { ok: true };      // unparseable date — don't block on it
  if (ageDays > allow) {
    return { ok: false, ageDays: +ageDays.toFixed(0), allowDays: allow, cadence: freq };
  }
  return { ok: true, ageDays: +ageDays.toFixed(0) };
}

// ──────────────────────────────────────────────────────────────
// Source cooldown
// ──────────────────────────────────────────────────────────────
// When a source (URL host) fails N times in a row across runs, mark it
// "cooled-down" for K hours. Tier orchestrator will skip cooled sources.

const COOLDOWN_THRESHOLD = 3;     // 3 consecutive failures
const COOLDOWN_HOURS = 6;          // skip for next 6 hours

function loadCooldown() {
  if (!existsSync(COOLDOWN_FILE)) return {};
  try { return JSON.parse(readFileSync(COOLDOWN_FILE, 'utf8')); } catch { return {}; }
}

function saveCooldown(state) {
  try { writeFileSync(COOLDOWN_FILE, JSON.stringify(state, null, 2)); } catch {}
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url.slice(0, 60); }
}

/**
 * Should we skip this source for now? Returns true if it's in cooldown.
 */
export function isInCooldown(url) {
  const state = loadCooldown();
  const entry = state[hostOf(url)];
  if (!entry || !entry.cooled_until) return false;
  return Date.now() < new Date(entry.cooled_until).getTime();
}

/**
 * Record outcome of a source fetch. After N consecutive failures, enter cooldown.
 */
export function recordSourceOutcome(url, success) {
  const host = hostOf(url);
  const state = loadCooldown();
  const entry = state[host] || { consecutive_failures: 0 };
  if (success) {
    entry.consecutive_failures = 0;
    entry.last_success_at = new Date().toISOString();
    delete entry.cooled_until;
  } else {
    entry.consecutive_failures = (entry.consecutive_failures || 0) + 1;
    entry.last_failure_at = new Date().toISOString();
    if (entry.consecutive_failures >= COOLDOWN_THRESHOLD) {
      entry.cooled_until = new Date(Date.now() + COOLDOWN_HOURS * 3600 * 1000).toISOString();
    }
  }
  state[host] = entry;
  saveCooldown(state);
}

// ──────────────────────────────────────────────────────────────
// LLM telemetry — track per-provider call count + success rate
// ──────────────────────────────────────────────────────────────

const DAILY_LIMITS = {
  groq:        14400,    // requests/day, very generous
  gemini:      1500,     // requests/day (Gemini Flash free tier)
  cloudflare:  10000     // neurons/day
};

function loadTelemetry() {
  if (!existsSync(LLM_TELEMETRY_FILE)) return { day: null, providers: {} };
  try { return JSON.parse(readFileSync(LLM_TELEMETRY_FILE, 'utf8')); } catch { return { day: null, providers: {} }; }
}

function saveTelemetry(t) {
  try { writeFileSync(LLM_TELEMETRY_FILE, JSON.stringify(t, null, 2)); } catch {}
}

export function recordLlmCall(provider, success) {
  const today = new Date().toISOString().slice(0, 10);
  const t = loadTelemetry();
  if (t.day !== today) { t.day = today; t.providers = {}; }
  const p = t.providers[provider] || { calls: 0, successes: 0, failures: 0 };
  p.calls++;
  if (success) p.successes++; else p.failures++;
  p.success_rate = +(p.successes / p.calls).toFixed(3);
  p.daily_limit = DAILY_LIMITS[provider] || null;
  p.headroom_pct = p.daily_limit ? +(100 * (1 - p.calls / p.daily_limit)).toFixed(1) : null;
  t.providers[provider] = p;
  saveTelemetry(t);
}

export function getLlmTelemetry() { return loadTelemetry(); }

// ──────────────────────────────────────────────────────────────
// Anomaly detection — compare new value to historical sparkline
// ──────────────────────────────────────────────────────────────
// Catches "plausible but anomalous" values that pass static plausibility
// bands but are statistically outliers vs the metric's own history.

const Z_SCORE_THRESHOLD = 4;  // > 4 sigma = suspicious

/**
 * Given a new value and an array of historical values, return:
 *   { suspicious: bool, z: number, reason: string }
 *
 * Returns suspicious=false if there's insufficient history (< 5 points).
 */
export function checkAnomaly(value, history) {
  if (!Array.isArray(history) || history.length < 5) {
    return { suspicious: false, reason: 'insufficient history' };
  }
  const nums = history.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 5) return { suspicious: false, reason: 'insufficient numeric history' };

  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const stddev = Math.sqrt(variance) || 1e-9;
  const z = Math.abs((value - mean) / stddev);
  if (z > Z_SCORE_THRESHOLD) {
    return { suspicious: true, z: +z.toFixed(2), reason: `z=${z.toFixed(2)} (>${Z_SCORE_THRESHOLD})`, mean: +mean.toFixed(2), stddev: +stddev.toFixed(2) };
  }
  return { suspicious: false, z: +z.toFixed(2) };
}
