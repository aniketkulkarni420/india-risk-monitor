#!/usr/bin/env node
// Bundle all metric JSONs into a single fast-load file at app/dist/data.json.
// Phase 5 dependency. Renderer fetches this once instead of 70 individual files.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';
import { freshnessFor } from './freshness-spec.mjs';
import { evaluateStatus } from './evaluate-status.mjs';
import { applyPlausibilityGuard } from './plausibility-guard.mjs';
import { recomputeComposites } from './composite-recompute.mjs';
import { loadHealthSummary } from './parser-health.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const HISTORY = join(DATA, 'history');
const OUT = join(ROOT, 'app', 'dist', 'data.json');

mkdirSync(dirname(OUT), { recursive: true });

const SKIP_DIRS = new Set(['snapshots', 'manual-overrides', 'self-heal-reports']);
const SKIP_FILES = new Set(['manifest.json', 'parser-health.json', 'source-cooldown.json', 'llm-telemetry.json']);
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && !SKIP_FILES.has(name)) out.push(p);
  }
  return out;
}

// Read the previous-day value from history CSV. Returns null if history is
// too thin to compute a meaningful day-over-day change.
function previousDayValue(metric_id, currentAsOf) {
  const file = join(HISTORY, `${metric_id}.csv`);
  if (!existsSync(file)) return null;
  let rows;
  try {
    rows = readFileSync(file, 'utf8').trim().split('\n').slice(1)
      .map(l => l.split(','))
      .filter(r => r.length >= 2 && !Number.isNaN(parseFloat(r[1])))
      .map(r => ({ date: r[0], value: parseFloat(r[1]) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return null; }
  if (rows.length < 2) return null;
  // Find the entry just before the most recent
  const last = rows[rows.length - 1];
  // Walk back to find a row with a different value (skip duplicate same-day rows)
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].date !== last.date) return rows[i];
  }
  return null;
}

// Sanitize sparkline_12m at bundle time. If the array contains a unit-shift
// remnant (max/min ratio > 50), keep only the values that share an order of
// magnitude with the current value. Catches Phase-1 seed values that hang
// around when a parser ships with different units.
function sanitizeSparkline(metric) {
  if (!Array.isArray(metric.sparkline_12m) || metric.sparkline_12m.length === 0) return;
  const sl = metric.sparkline_12m.filter(v => typeof v === 'number');
  if (sl.length === 0) return;
  const cur = metric.value;
  if (typeof cur !== 'number' || cur === 0) return;
  const positives = sl.map(Math.abs).filter(v => v > 0);
  if (positives.length < 2) return;
  const max = Math.max(...positives);
  const min = Math.min(...positives);
  if (max / min < 50) return;  // sparkline is fine, no shift detected

  // Unit shift detected. Keep only values within 0.3x-3x of current value.
  const lo = Math.abs(cur) * 0.3;
  const hi = Math.abs(cur) * 3.0;
  const clean = metric.sparkline_12m.filter(v =>
    typeof v === 'number' && Math.abs(v) >= lo && Math.abs(v) <= hi
  );
  metric.sparkline_12m = clean;
  metric._sparkline_sanitized = `dropped ${sl.length - clean.length} unit-shift values`;
}

// Cleanup #2 · trailing flat-line tail. When a parser ships with N months of
// real history and pads the rest with the current value, the sparkline shows
// a fake flat trend on the right edge. Detect and trim. Example before:
//   [1.89, 1.96, 1.75, 1.79, 1.99, 1.89, 1.89, 1.89, 1.89, 1.89, 1.89, 1.89]
// After:
//   [1.89, 1.96, 1.75, 1.79, 1.99, 1.89]   ← caller can show "X/12 months"
function trimFlatTail(metric) {
  const sl = metric.sparkline_12m;
  if (!Array.isArray(sl) || sl.length < 4) return;
  // Find the run of identical trailing values
  const last = sl[sl.length - 1];
  let runStart = sl.length;
  for (let i = sl.length - 1; i >= 0; i--) {
    if (sl[i] === last) runStart = i;
    else break;
  }
  const runLen = sl.length - runStart;
  if (runLen < 3) return;   // 1-2 identical trailing values can be coincidence
  // Trim to the last value before the flat run, plus the flat-tail's first value
  // (so renderers know "this is where data stopped"). Keep at least 2 values.
  const kept = sl.slice(0, Math.max(2, runStart + 1));
  metric.sparkline_12m = kept;
  metric._sparkline_tail_trimmed = `dropped ${runLen - 1} flat-tail values (parser seed contamination)`;
}

// Cleanup #3 · leading flat-line head. When a parser was registered with N
// months of seed-padding at the FRONT (e.g. Hormuz [84,84,...,84,148] where
// 84 was the static-snapshot seed and 148 is the first real value), the
// sparkline shows a fake flat history. Detect a leading run of >=4 identical
// values and trim it, keeping the last seed value as an anchor so renderers
// can show "history accruing · N real points".
function trimFlatHead(metric) {
  const sl = metric.sparkline_12m;
  if (!Array.isArray(sl) || sl.length < 5) return;
  const first = sl[0];
  let runEnd = 0;
  for (let i = 0; i < sl.length; i++) {
    if (sl[i] === first) runEnd = i;
    else break;
  }
  const runLen = runEnd + 1;
  if (runLen < 4) return;            // short leading run can be coincidence
  if (runLen === sl.length) return;  // all identical — leave for sanitize/other logic
  // Keep one anchor seed value + everything after the run.
  const kept = sl.slice(runEnd);
  metric.sparkline_12m = kept;
  metric._sparkline_head_trimmed = `dropped ${runLen - 1} leading flat values (parser seed contamination) · ${kept.length} real points`;
  metric._history_state = 'accruing';
}

// Sanity guard for day-over-day deltas. The history CSV may contain Phase-1
// mock-seed values from before a parser was registered; when the parser later
// switched to real data with different units / sign convention, the prev/current
// ratio explodes. We refuse to publish dod if any of these is true:
//   1. |dod_pct| > 25 AND metric is not shock_eligible (rate moves > 25/day are
//      either a unit shift or a genuine event we should treat carefully)
//   2. ratio current/prev is outside [0.5, 2.0] (suggests unit shift)
//   3. sign flipped between prev and current AND metric isn't naturally zero-crossing
function dodIsTrustworthy(metric, prev) {
  const cur = metric.value;
  if (typeof cur !== 'number' || typeof prev?.value !== 'number') return false;
  if (prev.value === 0) return false;
  const dodPct = ((cur - prev.value) / Math.abs(prev.value)) * 100;
  // (1) magnitude check
  const isShockEligible = !!metric.shock_eligible;
  if (Math.abs(dodPct) > 25 && !isShockEligible) return false;
  // (2) ratio check
  const ratio = cur / prev.value;
  if (Math.abs(ratio) < 0.5 || Math.abs(ratio) > 2.0) return false;
  // (3) sign flip check (allow only if metric naturally crosses zero — spreads, deltas)
  const allowSignFlip = ['ind_us_10y_spread', 'high_yield_credit_spread', 'wacr_repo_spread', 'real_10y_yield'].includes(metric.metric_id)
    || metric.value_format === 'bps';
  if (!allowSignFlip && Math.sign(cur) !== Math.sign(prev.value) && cur !== 0 && prev.value !== 0) return false;
  return true;
}

const metrics = {};
let sectors = null;
let dodAccepted = 0, dodRejected = 0, sparklineSanitized = 0, anomalyCount = 0;

for (const file of walk(DATA)) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.metric_id) {
    // Sanitize sparkline first (unit-shift detection + flat-tail/head trim)
    sanitizeSparkline(data);
    trimFlatTail(data);
    trimFlatHead(data);
    if (data._sparkline_sanitized || data._sparkline_tail_trimmed || data._sparkline_head_trimmed) sparklineSanitized++;

    // 2026-05-12 · Plausibility · when sparkline has <4 unique values, MoM/YoY
    // math is technically valid but semantically meaningless (e.g. Hormuz [2, 84]
    // → +4117% MoM). Drop trend percentages so renderer shows "history accruing".
    {
      const sl = data.sparkline_12m || [];
      const uniq = new Set(sl.filter(v => typeof v === 'number')).size;
      const trendCap = 200; // any |trend| above this with thin history is suspect
      if (uniq < 4) {
        if (typeof data.mom_pct === 'number' && Math.abs(data.mom_pct) > trendCap) {
          data._mom_pct_suppressed = data.mom_pct;
          data.mom_pct = null;
        }
        if (typeof data.yoy_pct === 'number' && Math.abs(data.yoy_pct) > trendCap) {
          data._yoy_pct_suppressed = data.yoy_pct;
          data.yoy_pct = null;
        }
        if (data._mom_pct_suppressed || data._yoy_pct_suppressed) {
          data._history_accruing = true;
        }
      }
    }

    // 2026-05-12 · Value-stuck detector · when the metric's most-recent N history
    // entries all match the current value AND it's not a slow-moving metric, flag.
    // The freshness rule (is_stale) checks age vs cadence but misses parsers that
    // re-publish the same number every cycle.
    if (Array.isArray(data.sparkline_12m) && data.sparkline_12m.length >= 3) {
      const slowMoving = ['repo_rate', 'cad_pct_gdp', 'fiscal_deficit_pct', 'cpi_inflation', 'wpi_inflation', 'iip_growth', 'pmi_combined'];
      if (!slowMoving.includes(data.metric_id)) {
        const tail = data.sparkline_12m.slice(-7).filter(v => typeof v === 'number');
        const allSame = tail.length >= 3 && tail.every(v => v === data.value);
        if (allSame) {
          data.is_value_stuck = true;
          data._value_stuck_count = tail.length;
        }
      }
    }

    // 2026-05-12 · Verification state DERIVATION (Tier 5)
    // verification_state stamped at metric-JSON-authoring time can lie. Override
    // at bundle-time based on observable facts:
    //   • Static-source flag → force "source_pending"
    //   • _source_count_actual < 2 → force "source_pending" (no real cross-check ran)
    //   • Otherwise leave as-stamped
    if (data._source_static === true) {
      if (data.verification_state !== 'source_pending') {
        data._verification_state_original = data.verification_state;
        data.verification_state = 'source_pending';
        data._verification_demoted_reason = 'static_source';
      }
    } else if (typeof data._source_count_actual === 'number' && data._source_count_actual < 2 && data.verification_state === 'verified') {
      // Authoritative single-source metrics that genuinely have only one canonical source
      // are exempted by inclusion in this whitelist.
      const singleSourceAuthoritative = ['repo_rate', 'cpi_inflation', 'wpi_inflation', 'india_risk_score'];
      if (!singleSourceAuthoritative.includes(data.metric_id)) {
        data._verification_state_original = data.verification_state;
        data.verification_state = 'source_pending';
        data._verification_demoted_reason = 'single_source';
      }
    }

    // Plausibility guard · runs BEFORE dod compute. If today's value is wildly
    // off from yesterday's (e.g. INR/USD jumping 14% in a day), roll back to
    // yesterday's value to avoid showing a screenshot-bait number on the live site.
    const prev = previousDayValue(data.metric_id, data.as_of);
    const anomaly = prev ? applyPlausibilityGuard(data, prev.value) : null;
    if (anomaly) {
      anomalyCount++;
      console.log(`  · plausibility rollback · ${data.metric_id}: ${anomaly.rolledBack} → ${anomaly.restoredTo} (move ${anomaly.dodAbsPct}% > cap ${anomaly.cap}%)`);
    }

    // Compute day-over-day delta + percentage if history allows AND data is trustworthy
    if (prev && !anomaly && dodIsTrustworthy(data, prev)) {
      data.dod_delta = +(data.value - prev.value).toFixed(4);
      data.dod_pct = +(((data.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(2);
      data.dod_prev_date = prev.date;
      data.dod_prev_value = prev.value;
      dodAccepted++;
    } else if (prev && !anomaly) {
      dodRejected++;
    }
    // Status auto-recompute · against trigger_thresholds (or score band for composites).
    // Prior bug: data.status was a stamped field that never updated when value changed,
    // causing false SHOCK pills on Brent/Hormuz after they dropped below thresholds.
    const newStatus = evaluateStatus(data);
    if (newStatus && newStatus !== data.status) {
      data._status_was = data.status;       // breadcrumb for debugging
      data.status = newStatus;
    }

    // Freshness flag · derived from per-metric expected cadence (freshness-spec.mjs).
    // is_stale = true when (today - as_of) > cadence_days. UI surfaces a STALE
    // pill so users can see at scan-time which numbers are past their refresh window.
    const fr = freshnessFor(data.metric_id, data.as_of);
    data.is_stale = fr.is_stale;
    data.age_days = fr.age_days;
    data.cadence_days = fr.cadence_days;
    metrics[data.metric_id] = data;
  } else if (data.section === 'sectors' && Array.isArray(data.sectors)) {
    sectors = data;
  }
}
console.log(`  · dod accepted: ${dodAccepted} · rejected (unit shift / sign flip / mock seed): ${dodRejected}`);
if (sparklineSanitized > 0) console.log(`  · sparkline sanitized (unit-shift remnants dropped): ${sparklineSanitized}`);

// Composite re-derivation pass · drivers + risk score must reflect freshly-recomputed
// statuses on the underlying metrics. Without this they keep old composite scores from
// the prior ingest run (e.g. driver_oil_physical stays at 92 even after Brent drops below shock).
const metricsMap = new Map(Object.entries(metrics));
const compositeChanges = recomputeComposites(metricsMap);
// Re-stamp composite status from new score after recompute
for (const ch of compositeChanges) {
  const m = metricsMap.get(ch.id);
  if (!m) continue;
  const newStatus = evaluateStatus(m);
  if (newStatus && newStatus !== m.status) {
    m._status_was_composite = m.status;
    m.status = newStatus;
  }
  metrics[ch.id] = m;  // write-back into the plain object
}
if (compositeChanges.length) {
  console.log(`  · composites re-derived (${compositeChanges.length}): ${compositeChanges.map(c => `${c.id} ${c.old}→${c.new}`).join(', ')}`);
}

// ───────────────── FRESHNESS REPORT (Tier C · 2026-05-26, redesigned 2026-05-29) ─────────────────
// IMPORTANT DESIGN NOTE: this used to `process.exit(1)` when >15% of metrics
// were stale. That was WRONG for the deploy path — `dist/data.json` is
// gitignored and rebuilt by Cloudflare Pages on every deploy via this script.
// So when data went stale, the gate FAILED the Cloudflare build, which meant
// Cloudflare kept serving the OLD bundle — freezing the live site on even
// staler data. The gate meant to prevent stale-shipping instead prevented
// the recovery. (Observed 2026-05-29: live bundle stuck at 39.9h.)
//
// Correct separation of concerns:
//   - bundle.mjs ALWAYS writes the freshest-available data (availability).
//     Deploy must never be blocked — shipping fresh-as-possible always beats
//     freezing on older data.
//   - The freshness REPORT is embedded in the bundle (UI + showcase-ready
//     read it).
//   - ENFORCEMENT lives elsewhere: `showcase-ready.mjs` (on-demand demo gate)
//     and `freshness-audit.yml` (daily Telegram alert). Those tell the human;
//     they don't freeze the deploy.
//   - Opt-in hard-fail for a DEDICATED CI check only: IRM_FRESHNESS_GATE_STRICT=1.
const FRESHNESS_GATE_PCT = parseFloat(process.env.IRM_FRESHNESS_GATE_PCT || '15');
const FRESHNESS_GATE_STRICT = process.env.IRM_FRESHNESS_GATE_STRICT === '1';
const FRESHNESS_GATE_DAYS_BY_CADENCE = {
  'Live': 2, 'Daily': 2, 'Weekly': 10, 'Fortnightly': 21,
  'Monthly': 45, 'Quarterly': 120, 'Per release': 180
};
const FRESHNESS_GATE_DAYS_DEFAULT = 14;

// A metric is "frozen" when it hasn't had a proven-live fetch (last_live_fetch_at)
// within FROZEN_FACTOR × its cadence — even if last_verified_at is recent. This
// is the cache-masking detector: a rotted source served from cache keeps
// last_verified_at fresh but last_live_fetch_at stops advancing.
const FROZEN_FACTOR = parseFloat(process.env.IRM_FROZEN_FACTOR || '2');

const freshnessReport = (() => {
  const now = Date.now();
  const offenders = [];
  const frozen = [];
  let totalChecked = 0;
  for (const [id, m] of Object.entries(metrics)) {
    if (id.startsWith('driver_') || id === 'india_risk_score' || id.endsWith('_state') || id.endsWith('_regime')) continue;
    totalChecked++;
    const lv = m.last_verified_at;
    const freq = m.source_primary?.frequency || 'Daily';
    const thresholdDays = FRESHNESS_GATE_DAYS_BY_CADENCE[freq] ?? FRESHNESS_GATE_DAYS_DEFAULT;
    // Frozen check: proven-liveness age. Fall back to last_verified_at only when
    // last_live_fetch_at is absent (pre-A1 data) so we don't false-alarm on old metrics.
    const liveStamp = m.last_live_fetch_at || lv;
    if (liveStamp) {
      const liveAge = (now - new Date(liveStamp).getTime()) / 86400000;
      if (liveAge > thresholdDays * FROZEN_FACTOR) {
        frozen.push({ id, liveAgeDays: +liveAge.toFixed(1), thresholdDays, cadence: freq, data_origin: m.data_origin || null });
      }
    }
    if (!lv) { offenders.push({ id, ageDays: null, thresholdDays, cadence: freq, reason: 'no last_verified_at' }); continue; }
    const ageDays = (now - new Date(lv).getTime()) / 86400000;
    if (ageDays > thresholdDays) offenders.push({ id, ageDays: +ageDays.toFixed(1), thresholdDays, cadence: freq });
  }
  const stalePct = totalChecked ? +((offenders.length / totalChecked) * 100).toFixed(1) : 0;
  const overThreshold = stalePct > FRESHNESS_GATE_PCT;

  if (overThreshold) {
    // WARNING, not error — never blocks the deploy. The site still gets the
    // freshest-available data; the alert tells the human to investigate.
    console.warn(`\n::warning::Freshness: ${offenders.length} of ${totalChecked} metrics stale (${stalePct}% > ${FRESHNESS_GATE_PCT}% target). Shipping freshest-available anyway; showcase-ready + freshness-audit will flag.`);
    for (const o of offenders.slice(0, 15)) {
      console.warn(`  · ${o.id.padEnd(28)} ${o.cadence.padEnd(10)} age ${String(o.ageDays ?? '?').padEnd(8)} threshold ${o.thresholdDays}d ${o.reason || ''}`);
    }
    if (offenders.length > 15) console.warn(`  · ... and ${offenders.length - 15} more`);
    if (FRESHNESS_GATE_STRICT) {
      console.error('::error::IRM_FRESHNESS_GATE_STRICT=1 set — failing build on staleness (dedicated CI check, NOT the deploy path).');
      process.exit(1);
    }
  } else if (offenders.length) {
    console.log(`  · freshness: ${offenders.length} stale (${stalePct}% < ${FRESHNESS_GATE_PCT}% target · within tolerance)`);
  } else {
    console.log(`  · freshness: all ${totalChecked} metrics within cadence ✓`);
  }
  if (frozen.length) {
    console.warn(`\n::warning::Frozen-liveness: ${frozen.length} metric(s) have not had a proven-live fetch in >${FROZEN_FACTOR}× cadence (possible cache-masking / rotted source):`);
    for (const f of frozen.slice(0, 15)) {
      console.warn(`  · ${f.id.padEnd(28)} ${f.cadence.padEnd(10)} live-age ${String(f.liveAgeDays).padEnd(8)} origin=${f.data_origin || '?'}`);
    }
  }
  return {
    checked: totalChecked,
    stale_count: offenders.length,
    stale_pct: stalePct,
    over_threshold: overThreshold,
    threshold_pct: FRESHNESS_GATE_PCT,
    stale: offenders,
    frozen_count: frozen.length,
    frozen
  };
})();

const bundle = {
  generated_at: new Date().toISOString(),
  metric_count: Object.keys(metrics).length,
  metrics,
  sectors,
  freshness: freshnessReport,  // cadence-aware stale list · read by showcase-ready + UI staleness badges
  parser_health: loadHealthSummary(),  // X/Y green · red metrics list · for dashboard health badge
  // System staleness banner (Tier B addition · 2026-05-12)
  // Dashboard renders a warning ribbon if too many parsers are red.
  system_state: (() => {
    const ph = loadHealthSummary();
    const sum = ph?.summary || { green: 0, amber: 0, red: 0, total: 0 };
    const total = sum.total || 1;
    const redPct = (sum.red / total) * 100;
    if (redPct >= 25) return { level: 'degraded', message: `${sum.red} of ${total} parsers are red — data may be stale`, red_pct: +redPct.toFixed(1) };
    if (redPct >= 10) return { level: 'partial', message: `${sum.red} of ${total} parsers are red`, red_pct: +redPct.toFixed(1) };
    return { level: 'healthy', red_pct: +redPct.toFixed(1) };
  })()
};

writeFileSync(OUT, JSON.stringify(bundle), 'utf8');
console.log(`✓ bundled ${bundle.metric_count} metrics + ${sectors ? sectors.sectors.length : 0} sectors → app/dist/data.json (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`);
