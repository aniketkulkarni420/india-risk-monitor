#!/usr/bin/env node
// Self-improvement loop · auto-optimizes tier routing from observed reliability.
//
// "The system self-corrects and improves along the way" — this is that engine.
//
// SAFE BY DESIGN: it only ever REORDERS a metric's tier_chain (and quarantines
// dead tiers to the back). It NEVER edits a value, regex, cadence, or
// plausibility band — those are the things that could corrupt data, and they
// stay human-gated via self-heal.mjs. Every tier in a chain is an already-
// validated parser, so changing the ORDER cannot change WHAT value is produced,
// only how fast/reliably it's reached.
//
// What it does each run (reads data/tier-stats.json, written by tiered_v1.mjs):
//   1. For each tiered metric, score each tier by its recent success rate.
//   2. Promote reliably-winning tiers to the front; sink flaky ones.
//   3. Quarantine "dead" tiers (0 recent successes over a window) to the back —
//      never removed, so a recovered source is auto-tried again when the front
//      tier later fails, and auto-promoted once it starts succeeding.
//   4. Tiers with too little data keep their position (no premature moves).
//   5. Log every change to data/self-improvement-log.json (audit trail) and
//      Telegram a summary, so the system improving itself is VISIBLE.
//
// Guardrails: set equality asserted (no tier ever lost); per-metric opt-out via
// "_no_auto_reorder": true; global kill switch IRM_AUTO_OPTIMIZE=0 (report only).
//
// Usage:
//   node scripts/optimize-reliability.mjs            · apply + log + alert
//   node scripts/optimize-reliability.mjs --dry-run  · report only, no writes
//   node scripts/optimize-reliability.mjs --json      · machine-readable

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMetrics, writeMetric } from './ingest/persistence.mjs';
import { getTierStats } from './ingest/observability.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_FILE = join(ROOT, 'data', 'self-improvement-log.json');

const DRY = process.argv.includes('--dry-run') || process.env.IRM_AUTO_OPTIMIZE === '0';
const JSON_OUT = process.argv.includes('--json');

// Confidence + death thresholds
const MIN_ATTEMPTS = 5;       // need ≥5 attempts before trusting a tier's rate
const DEAD_MIN_ATTEMPTS = 6;  // ≥6 attempts, 0 successes → dead
const DEAD_RECENT_RUN = 6;    // OR last 6 outcomes all failures → recently dead
const NEUTRAL = 0.5;          // assumed score for under-observed tiers (keep position)
const PROMOTE_MARGIN = 0.0;   // reorder fires on any improvement (stable sort prevents thrash)

function tierClass(stat) {
  if (!stat || !stat.attempts) return { kind: 'unknown', score: NEUTRAL };
  const recent = Array.isArray(stat.recent) ? stat.recent : [];
  const recentRate = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : (stat.success_rate ?? 0);
  const recentlyDead = recent.length >= DEAD_RECENT_RUN && recent.slice(-DEAD_RECENT_RUN).every(x => x === 0);
  const neverWorked = stat.attempts >= DEAD_MIN_ATTEMPTS && stat.successes === 0;
  if (recentlyDead || neverWorked) return { kind: 'dead', score: 0, recentRate };
  if (stat.attempts < MIN_ATTEMPTS) return { kind: 'unknown', score: NEUTRAL, recentRate };
  return { kind: 'confident', score: recentRate, recentRate };
}

// Stable-sort the chain: dead tiers last; within the rest, higher recent score
// first; ties (and unknowns at NEUTRAL) keep original order → no thrashing.
function optimizeChain(chain, metricStats) {
  const decorated = chain.map((tier, idx) => {
    const c = tierClass(metricStats?.[tier]);
    return { tier, idx, ...c };
  });
  const sorted = [...decorated].sort((a, b) => {
    const ga = a.kind === 'dead' ? 1 : 0;
    const gb = b.kind === 'dead' ? 1 : 0;
    if (ga !== gb) return ga - gb;              // dead group last
    if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;  // higher score first
    return a.idx - b.idx;                        // stable: preserve original order
  });
  return { newChain: sorted.map(d => d.tier), decorated, sorted };
}

function loadLog() {
  if (!existsSync(LOG_FILE)) return { entries: [] };
  try { return JSON.parse(readFileSync(LOG_FILE, 'utf8')); } catch { return { entries: [] }; }
}

// ── Main ──
const stats = getTierStats();
const metrics = listMetrics();
const changes = [];

for (const { metric_id, file, data } of metrics) {
  const sp = data.source_primary || {};
  const chain = sp.tier_chain;
  if (!Array.isArray(chain) || chain.length < 2) continue;     // nothing to reorder
  if (data._no_auto_reorder === true) continue;                // explicit opt-out
  const metricStats = stats[metric_id] || {};

  const { newChain, sorted } = optimizeChain(chain, metricStats);
  if (newChain.join('|') === chain.join('|')) continue;        // already optimal

  // Safety: the optimized chain must be a permutation of the original — no tier
  // added or lost. If this ever fails we skip (never silently drop a fallback).
  if (newChain.length !== chain.length || new Set(newChain).size !== new Set(chain).size ||
      !chain.every(t => newChain.includes(t))) {
    console.error(`!! ${metric_id}: optimized chain not a permutation — skipping`);
    continue;
  }

  const quarantined = sorted.filter(d => d.kind === 'dead').map(d => d.tier);
  const reason = sorted.map(d => `${d.tier.split(':').pop()}=${d.kind}${d.recentRate != null ? '(' + (d.recentRate).toFixed(2) + ')' : ''}`).join(', ');
  changes.push({ metric_id, file, from: chain, to: newChain, quarantined, reason });
}

// Report
const summary = {
  ran_at: new Date().toISOString(),
  mode: DRY ? 'dry-run' : 'apply',
  metrics_scanned: metrics.filter(m => Array.isArray(m.data.source_primary?.tier_chain) && m.data.source_primary.tier_chain.length >= 2).length,
  changes_count: changes.length,
  changes: changes.map(c => ({ metric_id: c.metric_id, from: c.from, to: c.to, quarantined: c.quarantined, reason: c.reason }))
};

if (JSON_OUT) { console.log(JSON.stringify(summary, null, 2)); }
else {
  console.log(`Self-improvement · ${summary.mode} · scanned ${summary.metrics_scanned} tiered metrics · ${changes.length} change(s)`);
  for (const c of changes) {
    console.log(`\n  ${c.metric_id}`);
    console.log(`    from: ${c.from.join(' → ')}`);
    console.log(`    to:   ${c.to.join(' → ')}`);
    if (c.quarantined.length) console.log(`    quarantined: ${c.quarantined.join(', ')}`);
    console.log(`    why: ${c.reason}`);
  }
  if (!changes.length) console.log('  No routing changes — all tier_chains already optimal for observed reliability.');
}

// Apply + log + alert
if (!DRY && changes.length) {
  for (const c of changes) {
    const { data } = listMetrics().find(m => m.metric_id === c.metric_id) || {};
    if (!data) continue;
    data.source_primary.tier_chain = c.to;
    data._reliability_optimized_at = summary.ran_at;
    writeMetric(c.file, data);
  }
  // Append to ledger
  const log = loadLog();
  log.entries.push(...changes.map(c => ({
    ts: summary.ran_at, metric_id: c.metric_id, action: c.quarantined.length ? 'reorder+quarantine' : 'reorder',
    from: c.from, to: c.to, quarantined: c.quarantined, reason: c.reason
  })));
  log.last_run = summary.ran_at;
  writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n', 'utf8');

  // Telegram — make self-improvement VISIBLE, not silent
  const TG = process.env.TELEGRAM_BOT_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (TG && CHAT) {
    const lines = [`🔁 IRM self-improvement · ${changes.length} routing change(s)`, ''];
    for (const c of changes.slice(0, 8)) {
      lines.push(`· ${c.metric_id}: ${c.to[0].split(':').pop()} → front${c.quarantined.length ? ` · quarantined ${c.quarantined.length}` : ''}`);
    }
    lines.push('', 'Tier order re-optimized from observed success rates. Values unaffected (reorder only).');
    try {
      await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ chat_id: CHAT, text: lines.join('\n') })
      });
    } catch {}
  }
  console.log(`\nApplied ${changes.length} change(s) · logged to data/self-improvement-log.json`);
}

process.exit(0);
