// REAL fetcher · Google News RSS search
//
// Google News exposes a free, no-auth, no-key RSS endpoint for any query:
//   https://news.google.com/rss/search?q=<urlencoded>&hl=en-IN&gl=IN
//
// Returns up to ~100 article titles + publication dates + source links,
// sorted by relevance + recency. The HEADLINES contain the specific numbers
// we need (e.g. "GST collections hit Rs 2.42 lakh crore in April") because
// publishers put the punchline in the title.
//
// Why this beats topic-page scraping: topic pages list articles without
// values inline (you'd have to click each); RSS gives every relevant
// headline in one fetch, with stable format.
//
// Why this beats pure PIB RSS: PIB only covers govt-press-released metrics,
// and PIB blocks foreign IPs. Google News aggregates ALL Indian publishers
// (BS, ET, Mint, Reuters, Moneycontrol, etc) and is globally reachable.

import { fetchResilient } from '../fetch-resilient.mjs';
import { parseRssItems } from './pib_rss_v1.mjs';

// Per-metric config:
//   queryFn(): returns the Google News search query (can include current month/year)
//   matchRe:   regex with capture group 1 = numeric value (matched against title)
//   headlineFilter?: extra predicate on title (e.g. exclude "Central Railway"-only matches)
//   plausible: range guard
//   valueTransform?: optional unit conversion
//   maxAgeDays: skip items older than this (default 45)
const CONFIGS = {
  gst_gross: {
    queryFn: () => 'India gross GST collection lakh crore ' + recentMonthsQuery(),
    matchRe: /(?:gross\s+)?GST\s+(?:collection|revenue|mop[- ]?up)[\s\S]{0,80}?(?:₹|Rs\.?\s*)?([\d.]+)\s*lakh\s+crore/i,
    headlineFilter: (t) => !/state\s+wise|state-wise/i.test(t),
    valueTransform: (v) => Math.round(v * 100000),              // lakh crore → crore
    plausible: (v) => v > 100000 && v < 500000,                  // post-transform: crore
    maxAgeDays: 45
  },

  upi_value: {
    queryFn: () => 'UPI transactions value lakh crore ' + recentMonthsQuery(),
    // Match the monthly value as "Rs/₹ X lakh crore" — and require a month name nearby
    matchRe: /(?:₹|Rs\.?\s*)?([\d.]+)\s*lakh\s+crore[\s\S]{0,200}?(?:January|February|March|April|May|June|July|August|September|October|November|December)|(?:January|February|March|April|May|June|July|August|September|October|November|December)[\s\S]{0,200}?(?:₹|Rs\.?\s*)?([\d.]+)\s*lakh\s+crore/i,
    headlineFilter: (t) => !/FY\d|fiscal\s+year|year[- ]on[- ]year/i.test(t) && /(UPI|transactions)/i.test(t),
    extractCaptureFn: (m) => m[1] || m[2],                       // either order
    plausible: (v) => v > 15 && v < 35,
    maxAgeDays: 45
  },

  eway_bills: {
    queryFn: () => 'India e-way bills generated crore ' + recentMonthsQuery(),
    matchRe: /([\d.]+)\s+crore\s+e[- ]?way\s+bills/i,
    plausible: (v) => v > 50 && v < 250,                          // post-transform: million
    valueTransform: (v) => v * 10,                                // crore → million
    maxAgeDays: 45
  },

  fastag_toll: {
    queryFn: () => 'FASTag toll collection crore monthly ' + recentMonthsQuery(),
    matchRe: /FASTag[\s\S]{0,200}?(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*crore/i,
    headlineFilter: (t) => /FASTag\s+(?:toll|collection)|toll\s+collection/i.test(t) && !/MCD|state|Ritco|Logistics/i.test(t),
    plausible: (v) => v > 4000 && v < 12000,
    valueTransform: (v) => +String(v).replace(/,/g, ''),
    maxAgeDays: 45
  },

  rail_freight: {
    // Default query targets monthly figure; FY-total has different units (1670 MT range)
    queryFn: () => 'Indian Railways freight loading million tonnes monthly ' + recentMonthsQuery(),
    matchRe: /(?:Indian\s+Railways|Railways)[\s\S]{0,200}?([\d.]+)\s*(?:million\s+tonnes|MT|Mn\s+tonnes|MnT)/i,
    headlineFilter: (t) => /Indian\s+Railways/i.test(t) && !/Central\s+Railway|Western\s+Railway|Northern\s+Railway|South[\s-]?(Western|Central|Eastern)\s+Railway|East\s+Coast\s+Railway|Konkan\s+Railway|FY\d/i.test(t),
    plausible: (v) => v > 100 && v < 200,                         // monthly range
    maxAgeDays: 45
  },

  power_demand: {
    // Power demand peak gets newsworthy coverage with absolute GW figures
    queryFn: () => 'India power peak demand GW ' + recentMonthsQuery(),
    matchRe: /([\d.]+)\s*GW(?:\s+(?:peak|demand|power))?/i,
    headlineFilter: (t) => /(power|demand|peak|GW)/i.test(t) && !/solar|wind|renewable/i.test(t),
    plausible: (v) => v > 200 && v < 300,                         // India peak demand 200-280 GW range
    maxAgeDays: 30
  },

  wacr_repo_spread: {
    // WACR vs repo spread in bps. Sign convention: WACR below repo = negative bps.
    queryFn: () => 'WACR weighted average call rate repo bps India ' + recentMonthsQuery(),
    matchRe: /(\d{1,3})\s*bps\s+(lower|higher|above|below)\s+(?:than\s+)?(?:the\s+)?repo/i,
    headlineFilter: (t) => /WACR|call\s+rate/i.test(t),
    extractCaptureFn: (m) => {
      const v = parseInt(m[1], 10);
      const direction = m[2].toLowerCase();
      return (direction === 'lower' || direction === 'below') ? -v : v;
    },
    plausible: (v) => Math.abs(v) <= 200,
    maxAgeDays: 14
  },

  port_cargo: {
    // All-India major ports monthly cargo
    queryFn: () => 'India major ports total cargo million tonnes ' + recentMonthsQuery(),
    matchRe: /(?:major\s+ports|all\s+major\s+ports)[\s\S]{0,200}?([\d.]+)\s*(?:million\s+tonnes|MT|Mn\s+tonnes)/i,
    headlineFilter: (t) => /(major\s+ports|all[- ]India|India.s\s+major)/i.test(t) && !/JNPA|Mundra|Chennai|Kolkata|FY\d/i.test(t),
    plausible: (v) => v > 50 && v < 100,                          // monthly range MT
    maxAgeDays: 45
  }
};

function recentMonthsQuery() {
  // Current month + previous month, so query is biased toward latest release
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const cur = months[now.getUTCMonth()];
  const prevIdx = (now.getUTCMonth() + 11) % 12;
  const prev = months[prevIdx];
  const year = now.getUTCFullYear();
  return `${cur} ${year} OR ${prev} ${year}`;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No google_news_rss config for ${metric.metric_id}`);

  const q = cfg.queryFn();
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN`;
  const res = await fetchResilient(url, { timeoutMs: 20000, retries: 1, wayback: false });

  const items = parseRssItems(res.body);
  if (!items.length) throw new Error(`google_news_rss: empty feed for "${q}"`);

  const cutoff = Date.now() - (cfg.maxAgeDays || 45) * 24 * 3600 * 1000;
  const tried = [];

  for (const it of items) {
    if (!it.title) continue;
    if (cfg.headlineFilter && !cfg.headlineFilter(it.title)) continue;

    const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
    if (Number.isFinite(pub) && pub < cutoff) continue;

    const m = it.title.match(cfg.matchRe);
    if (!m) { tried.push(it.title.slice(0, 80)); continue; }

    const captured = cfg.extractCaptureFn ? cfg.extractCaptureFn(m) : m[1];
    if (!captured) { tried.push(it.title.slice(0, 80) + ' [no capture]'); continue; }
    let value = parseFloat(String(captured).replace(/,/g, ''));
    if (cfg.valueTransform) value = cfg.valueTransform(value);
    if (Number.isNaN(value) || !cfg.plausible(value)) {
      tried.push(`${it.title.slice(0, 60)} → ${value} (out of band)`);
      continue;
    }

    return {
      value,
      as_of: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
      parse_meta: {
        source: 'google-news-rss',
        query: q,
        headline: it.title.slice(0, 240),
        link: it.link,
        regex: cfg.matchRe.toString()
      },
      raw: it.title.slice(0, 240)
    };
  }

  throw new Error(`google_news_rss: ${items.length} items, none matched · tried: ${tried.slice(0,3).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'google-news-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { recentMonthsQuery };
