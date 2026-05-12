// REAL fetcher · Nitter (free Twitter mirror) scrape
//
// Ministers tweet exact monthly figures. Strategy:
//   1) Try multiple Nitter mirror instances in priority order
//   2) Fetch the timeline HTML
//   3) Filter tweets by metric-specific regex
//   4) Extract the numeric value
//
// Mirrors rotate as some go down. Try several. Refresh list from
// https://github.com/zedeus/nitter/wiki/Instances periodically.

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

// Public Nitter mirrors (ordered by reliability as of 2026-05)
const NITTER_MIRRORS = [
  'https://nitter.tiekoetter.com',
  'https://nitter.privacydev.net',
  'https://nitter.net',
  'https://nitter.poast.org',
  'https://nitter.unixfox.eu',
  'https://nitter.no-logs.com'
];

// Per-metric: which handle + regex to find the figure in a tweet
const CONFIGS = {
  fastag_toll: {
    handle: 'nitin_gadkari',
    matchRe: /FASTag[\s\S]{0,200}?(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:crore|cr)/i,
    plausible: (v) => v > 4000 && v < 12000,
    valueParser: (s) => parseFloat(String(s).replace(/,/g, ''))
  },
  rail_freight: {
    handle: 'AshwiniVaishnaw',
    matchRe: /(?:freight\s+loading|loaded)[\s\S]{0,200}?([\d.]+)\s*(?:MT|Mn\s*tonnes|million\s*tonnes)/i,
    plausible: (v) => v > 100 && v < 200
  },
  port_cargo: {
    handle: 'sarbananda_sonowal',
    matchRe: /(?:major\s+ports|cargo\s+handled)[\s\S]{0,200}?([\d.]+)\s*(?:MT|Mn\s*tonnes|million\s*tonnes)/i,
    plausible: (v) => v > 50 && v < 100
  },
  cement_dispatches: {
    // DPIIT or commerce ministry handles
    handle: 'DPIITGoI',
    matchRe: /cement[\s\S]{0,200}?([\d.]+)\s*(?:MT|Mn\s*tonnes|million\s*tonnes)/i,
    plausible: (v) => v > 25 && v < 60
  }
};

// Pull tweets from Nitter HTML page (no API needed)
// Nitter mirror DOM varies slightly between forks/versions. Use multiple
// approaches to maximize extraction.
function extractTweets(html) {
  const out = [];

  // Approach 1: tweet-content blocks (most common Nitter DOM)
  const re1 = /<div\s+class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re1.exec(html)) !== null && out.length < 40) {
    const cleaned = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
      .replace(/\s+/g,' ').trim();
    if (cleaned.length > 5) out.push({ text: cleaned, date: null });
  }

  // Approach 2: timeline-item p tags (alternative DOM)
  if (out.length === 0) {
    const re2 = /<p\s+class="tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = re2.exec(html)) !== null && out.length < 40) {
      const cleaned = m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      if (cleaned.length > 5) out.push({ text: cleaned, date: null });
    }
  }

  // Approach 3: og:description meta tag (latest pinned/top tweet)
  if (out.length === 0) {
    const desc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i);
    if (desc) out.push({ text: desc[1], date: null });
  }

  return out;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No nitter_v1 config for ${metric.metric_id}`);

  const errors = [];
  for (const mirror of NITTER_MIRRORS) {
    const url = `${mirror}/${cfg.handle}`;
    try {
      const res = await fetchResilient(url, { timeoutMs: 15000, retries: 1, wayback: false, browserUa: true });
      if (!res.body || res.body.length < 1000) { errors.push(`${mirror}: empty body`); continue; }
      const tweets = extractTweets(res.body);
      if (!tweets.length) { errors.push(`${mirror}: no tweets parsed`); continue; }

      // Try to find latest matching tweet
      for (const t of tweets) {
        const m = t.text.match(cfg.matchRe);
        if (!m) continue;
        const value = cfg.valueParser ? cfg.valueParser(m[1]) : parseFloat(m[1]);
        if (!Number.isFinite(value) || !cfg.plausible(value)) continue;

        try { recordSnapshot(metric.metric_id, url, res.body, value, 'nitter_v1'); } catch {}

        return {
          value,
          as_of: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
          parse_meta: { source: 'nitter', mirror, handle: cfg.handle, tweet: t.text.slice(0, 200) },
          raw: m[0].slice(0, 200)
        };
      }
      errors.push(`${mirror}: ${tweets.length} tweets, none matched`);
    } catch (e) {
      errors.push(`${mirror}: ${(e.message||'').slice(0,80)}`);
    }
  }
  throw new Error(`nitter_v1: all ${NITTER_MIRRORS.length} mirrors failed for @${cfg.handle} · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'nitter-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { extractTweets, NITTER_MIRRORS };
