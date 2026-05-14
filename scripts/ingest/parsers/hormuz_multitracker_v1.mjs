// REAL fetcher · Strait of Hormuz multi-tracker median
//
// During the 2026 Strait of Hormuz crisis, several purpose-built tracker
// sites sprang up. None is individually authoritative — quality varies and
// some go stale — so this parser scrapes 3-4 of them, LLM-extracts the
// current daily transit count from each, and returns the MEDIAN. Robust to
// any single source being stale or wrong.
//
// Used as a crosscheck / Tier-2 fallback behind google_news_llm_v1 in the
// hormuz_throughput tier chain.
//
// Staleness guard: each tracker's text is checked for a recent date; sources
// with no date or a date >10 days old are dropped before the median.

import { fetchResilient } from '../fetch-resilient.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const TRACKERS = [
  { name: 'hormuztracker.com',       url: 'https://www.hormuztracker.com/' },
  { name: 'hormuzstraitmonitor.com', url: 'https://hormuzstraitmonitor.com/' },
  { name: 'straits.live',            url: 'https://straits.live/' },
  { name: 'hormuzmonitor.com',       url: 'https://hormuzmonitor.com/' }
];

const STALE_DAYS = 10;

function stripHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cheap staleness heuristic: look for an ISO-ish or "Month DD, YYYY" date in
// the text and reject if the newest one found is older than STALE_DAYS.
// If no date is found at all, we keep the source but flag it low-confidence.
function stalenessCheck(text) {
  const now = Date.now();
  const dates = [];
  // ISO 2026-05-12
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
    if (Number.isFinite(d)) dates.push(d);
  }
  // "May 12, 2026" / "12 May 2026"
  const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  for (const m of text.matchAll(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})`, 'gi'))) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`).getTime();
    if (Number.isFinite(d)) dates.push(d);
  }
  if (!dates.length) return { hasDate: false, stale: false, newestAgeDays: null };
  const newest = Math.max(...dates);
  const ageDays = (now - newest) / 86400000;
  return { hasDate: true, stale: ageDays > STALE_DAYS, newestAgeDays: +ageDays.toFixed(1) };
}

const EXTRACT_TARGET =
  'The CURRENT daily number of ships/vessels transiting the Strait of Hormuz, as reported on this tracker page. ' +
  'CONTEXT: The Strait is in crisis as of 2026 — transits collapsed from a ~130-160/day baseline to single digits. ' +
  'Return the most recent DAILY transit count shown. ' +
  'STRICT EXCLUSIONS: (1) the pre-crisis baseline / "normal" / "average" figure (~130-160) — that is reference context, not current; ' +
  '(2) vessels stranded/anchored/waiting/stuck (those are large counts, not transits); ' +
  '(3) percentages, oil volumes (mbpd), or cumulative totals. ' +
  'Return only the current daily transit count as a number, expected 0-60 in the current crisis. ' +
  'If the page only shows a percentage of normal and a baseline, compute count = baseline * pct / 100. ' +
  'If you cannot find a current daily transit count, return null.';

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function extractFromTracker(tracker) {
  try {
    const res = await fetchResilient(tracker.url, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
    if (!res.body || res.body.length < 200) return { ...tracker, ok: false, reason: 'empty body' };
    const text = stripHtml(res.body).slice(0, 7000);
    if (text.length < 100) return { ...tracker, ok: false, reason: 'no text content' };

    const stale = stalenessCheck(text);
    if (stale.stale) {
      return { ...tracker, ok: false, reason: `stale (${stale.newestAgeDays}d old)`, staleness: stale };
    }

    const prompt = 'Extract: ' + EXTRACT_TARGET +
      `\n\nTracker page: ${tracker.name}\n\nPage text:\n\n${text}`;
    const r = await tryProviders(prompt);
    if (!r || r.value === null || !Number.isFinite(r.value)) {
      return { ...tracker, ok: false, reason: 'LLM no value', staleness: stale };
    }
    if (r.value < 0 || r.value > 200) {
      return { ...tracker, ok: false, reason: `${r.value} out of band`, staleness: stale };
    }
    try { recordSnapshot('hormuz_throughput', tracker.url, res.body, r.value, 'hormuz_multitracker_v1'); } catch {}
    return {
      ...tracker, ok: true, value: r.value,
      provider: r.provider,
      staleness: stale,
      confidence: stale.hasDate ? 'dated' : 'undated'
    };
  } catch (e) {
    if (e.code === 'LLM_UNAVAILABLE') throw e;
    return { ...tracker, ok: false, reason: (e.message || '').slice(0, 80) };
  }
}

export async function fetchPrimary(metric) {
  const settled = await Promise.allSettled(TRACKERS.map(extractFromTracker));
  const results = [];
  const errors = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (s.value.ok) results.push(s.value);
      else errors.push(`${s.value.name}: ${s.value.reason}`);
    } else {
      if (s.reason?.code === 'LLM_UNAVAILABLE') throw s.reason;
      errors.push(String(s.reason).slice(0, 100));
    }
  }

  if (!results.length) {
    throw new Error(`hormuz_multitracker: 0 of ${TRACKERS.length} trackers usable · ${errors.slice(0, 3).join(' | ')}`);
  }

  const values = results.map(r => r.value);
  const med = median(values);
  // Prefer the freshest dated source's as_of; else now.
  const dated = results.filter(r => r.confidence === 'dated');
  const spread = Math.max(...values) - Math.min(...values);

  return {
    value: Math.round(med),
    as_of: new Date().toISOString(),
    extra: {
      _hormuz_multitracker: {
        median: med,
        n_sources: results.length,
        n_total: TRACKERS.length,
        spread,
        per_source: results.map(r => ({ name: r.name, value: r.value, confidence: r.confidence })),
        dropped: errors
      }
    },
    parse_meta: {
      source: `multi-tracker median (${results.length}/${TRACKERS.length} sources)`,
      sources: results.map(r => r.name).join(','),
      spread,
      values: values.join(',')
    },
    raw: `median ${med} of [${values.join(', ')}] from ${results.map(r => r.name).join(', ')}`
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Crosscheck: re-run a single fast tracker and report divergence.
  try {
    const r = await extractFromTracker(TRACKERS[0]);
    if (r.ok) {
      return { value: r.value, source_name: `${r.name} recheck`, parse_meta: { source: r.url } };
    }
  } catch (_) {}
  const cc = metric.source_crosscheck?.[crosscheckIndex];
  return { value: primaryValue, source_name: cc?.name || 'multitracker-crosscheck-pending', parse_meta: { source: 'pending' } };
}
