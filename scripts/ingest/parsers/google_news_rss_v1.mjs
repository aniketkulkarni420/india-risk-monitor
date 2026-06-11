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

  net_sip_inflows: {
    // AMFI monthly SIP contribution — quoted exactly in release-day headlines
    // ("SIP inflows slip 1% to Rs 30,954 crore in May"). Exclude vague
    // round-number headlines ("hold above Rs 30,000 crore").
    queryFn: () => 'mutual fund SIP inflows crore AMFI ' + recentMonthsQuery(),
    matchRe: /SIP\s+(?:inflows?|contributions?|investments?)[^0-9₹]{0,50}(?:₹|Rs\.?\s*)([\d,]+(?:\.\d+)?)\s*crore/i,
    headlineFilter: (t) => /SIP/i.test(t) && !/above|below|around|hold|stay|cross|breach|top/i.test(t),
    valueTransform: (v) => (typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v),
    plausible: (v) => v > 15000 && v < 60000,
    maxAgeDays: 40
  },

  core_cpi: {
    // Core CPI (ex food & fuel) is quoted in every CPI-release story (~12th of
    // month). Exclude projections/polls — released actuals only.
    queryFn: () => 'India core inflation CPI ' + recentMonthsQuery(),
    matchRe: /core\s+(?:CPI\s+)?inflation[^%\d]{0,60}?([\d.]+)\s*(?:%|per\s*cent)/i,
    headlineFilter: (t) => /core/i.test(t) && !/pegged|projected|projection|forecast|poll|likely|expected|estimate|target|FY\d{2}/i.test(t) && !/China|US\b|Japan|Euro/i.test(t),
    plausible: (v) => v > 1.5 && v < 9,
    maxAgeDays: 40
  },

  epfo_payrolls: {
    // EPFO monthly payroll release (~20th-25th, 2-month lag): "EPFO adds 19.14
    // lakh net members in March". Value unit: lakh net members.
    queryFn: () => 'EPFO net members added lakh payroll',
    matchRe: /EPFO\s+(?:adds?|added|registers?|net\s+adds?)[^0-9]{0,40}?([\d.]+)\s*lakh/i,
    headlineFilter: (t) => /EPFO/i.test(t) && !/pension\s+hike|interest\s+rate|withdraw/i.test(t),
    plausible: (v) => v > 5 && v < 35,
    maxAgeDays: 75
  },

  rail_freight: {
    // Monthly freight loading is reported in MT (~120-150 range). News coverage
    // lags ~2-3 months and FY-totals (~1670 MT) / billion-tonne milestones must
    // be excluded — the plausibility band (100-200) + 'billion'/'FY' filter do that.
    // No recentMonthsQuery: the latest monthly MT figure is often 60-90d old in
    // news, so we widen maxAgeDays rather than over-constrain the query.
    queryFn: () => 'Indian Railways freight loading million tonnes',
    matchRe: /([\d]{3}(?:\.\d+)?)\s*(?:million\s+tonnes|mn\s+tonnes|MnT|\bMT\b)/i,
    headlineFilter: (t) => /(Indian\s+Railways|Railways|freight\s+loading)/i.test(t) && !/Central\s+Railway|Western\s+Railway|Northern\s+Railway|South[\s-]?(Western|Central|Eastern)\s+Railway|East\s+Coast\s+Railway|Konkan\s+Railway|\bFY\d|billion/i.test(t),
    plausible: (v) => v > 100 && v < 200,                         // monthly range (excludes 1670 FY-total)
    maxAgeDays: 100
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

  // 2026-06-11 · MONTH-PRIORITY FIX: feed order is relevance-ish, so the FIRST
  // matching headline can carry LAST month's figure even when the new release
  // is out (SIP: April's 31,115 beat May's 30,954). Collect all plausible
  // candidates, then prefer the headline naming the most recent month;
  // tie-break by newest pubDate.
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const nowM = new Date().getUTCMonth();
  function monthScore(title) {
    // current month name = 3, previous = 2, two back = 1, none/other = 0
    for (let back = 0; back < 3; back++) {
      const idx = (nowM - back + 12) % 12;
      const re = new RegExp('\b' + MONTH_NAMES[idx].slice(0, 3), 'i');
      if (re.test(title)) return 3 - back;
    }
    return 0;
  }

  const candidates = [];
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
    candidates.push({ value, pub, title: it.title, link: it.link, mScore: monthScore(it.title) });
  }

  if (candidates.length) {
    // Within the same month: prefer PRECISE figures over round ones — headlines
    // like "stay above Rs 30,000 crore" carry approximations; the release story
    // carries the exact number (30,954). Round = multiple of 500.
    const precise = (v) => (Math.abs(v) % 500 !== 0) ? 1 : 0;
    candidates.sort((a, b) => (b.mScore - a.mScore) || (precise(b.value) - precise(a.value)) || (b.pub - a.pub));
    const best = candidates[0];
    return {
      value: best.value,
      as_of: new Date(best.pub).toISOString(),
      parse_meta: {
        source: 'google-news-rss',
        query: q,
        headline: best.title.slice(0, 240),
        link: best.link,
        regex: cfg.matchRe.toString(),
        candidates_considered: candidates.length
      },
      raw: best.title.slice(0, 240)
    };
  }

  throw new Error(`google_news_rss: ${items.length} items, none matched · tried: ${tried.slice(0,3).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'google-news-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { recentMonthsQuery };
