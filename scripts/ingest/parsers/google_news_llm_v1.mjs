// REAL fetcher · Google News RSS → article body → LLM extraction
//
// For metrics where headlines describe a story but the actual NUMBER lives
// inside the article body (e.g. "E-way bills dip 5% in April" - dip pct in
// headline, absolute count in 3rd paragraph), this two-step parser:
//
//   1) Query Google News RSS with metric-specific keywords
//   2) Pick top N relevant articles (by source quality + headline-filter)
//   3) Fetch each article URL, strip HTML to text, send to free LLM
//   4) Take first plausible value
//
// Uses the LLM stack from llm_extract_v1 (Groq -> Gemini -> Cloudflare).
// All free. No paid services.

import { fetchResilient } from '../fetch-resilient.mjs';
import { parseRssItems } from './pib_rss_v1.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Shared Playwright browser, lazy-loaded
let _pwBrowserPromise = null;
async function getBrowser() {
  if (!_pwBrowserPromise) {
    let pw;
    try { pw = require('playwright'); } catch { return null; }
    _pwBrowserPromise = pw.chromium.launch({ headless: true });
    const close = async () => { try { const b = await _pwBrowserPromise; await b.close(); } catch {} };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }
  return _pwBrowserPromise;
}

/**
 * Fetch a Google News article URL. Google News uses encoded redirects that
 * require JS to resolve, so we launch Playwright to follow them and grab
 * the final publisher page body.
 */
async function fetchArticleBody(url, { timeoutMs = 25000 } = {}) {
  // If not a Google News redirector, use cheap fetch
  if (!/news\.google\.com\/rss\/articles\//.test(url)) {
    const res = await fetchResilient(url, { timeoutMs, retries: 1, wayback: false, browserUa: true });
    return { body: res.body, finalUrl: res.url };
  }
  // Use Playwright to resolve redirect + grab page
  const browser = await getBrowser();
  if (!browser) {
    // Playwright unavailable — fall back to direct fetch (likely returns Google News placeholder)
    const res = await fetchResilient(url, { timeoutMs, retries: 1, wayback: false, browserUa: true });
    return { body: res.body, finalUrl: res.url };
  }
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-IN'
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Google News bounces to publisher via JS; wait briefly for the navigation to complete
    await page.waitForTimeout(2000);
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    const body = await page.content();
    const finalUrl = page.url();
    return { body, finalUrl };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// Per-metric config:
//   queryFn(): Google News search query
//   target:    one-sentence instruction to the LLM
//   plausible: numeric range guard
//   headlineFilter?: cheap pre-filter on titles (avoid LLM cost on irrelevant articles)
//   sourceWhitelist?: prefer articles from these domains (more reliable)
//   maxArticles: how many top articles to try (default 4)
//   maxBodyChars: how much of article body to send to LLM (default 6000)
//   maxAgeDays: skip items older than this (default 45)
const CONFIGS = {
  eway_bills: {
    queryFn: () => 'India e-way bills generated April 2026 OR May 2026',
    target: 'the absolute monthly count of e-way bills generated in India for the most recent month, in crore (units, not value). Headlines often say "X crore e-way bills" or describe it as "rose Y% to Z crore". Return the absolute count, not percentage.',
    headlineFilter: (t) => /e[- ]?way\s+bill/i.test(t),
    // sourceWhitelist removed — LLM + plausibility band guard quality
    plausible: (v) => v > 5 && v < 25,         // in crore (units)
    valueTransform: (v) => v * 10,             // crore → million (existing unit)
    maxArticles: 4,
    maxAgeDays: 45
  },

  fastag_toll: {
    queryFn: () => 'FASTag monthly toll collection India crore April 2026 OR May 2026',
    target: 'the monthly FASTag toll collection amount for India in INR crore. Headlines may mention NHAI or specific months. Return the absolute monthly collection, not annual or pricing.',
    headlineFilter: (t) => /FASTag/i.test(t) && !/Annual\s+Pass|costlier|price|fee/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 4000 && v < 12000,
    maxArticles: 4,
    maxAgeDays: 45
  },

  rail_freight: {
    queryFn: () => 'Indian Railways freight loading million tonnes monthly April 2026 OR May 2026',
    target: 'the all-India monthly freight loading of Indian Railways in million tonnes (MT). Exclude single-zone figures (Central/Western/Northern Railway). Exclude full-year FY totals (those are 1500-1800 MT range). Return only the monthly all-India figure.',
    headlineFilter: (t) => /Indian\s+Railways|freight\s+loading/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 100 && v < 200,
    maxArticles: 4,
    maxAgeDays: 45
  },

  port_cargo: {
    queryFn: () => 'India major ports cargo million tonnes April 2026 OR May 2026',
    target: 'the monthly all-India major ports total cargo throughput in million tonnes (MT). Exclude single-port figures (JNPA, Mundra, Chennai) and full-year totals (those are 800-1000 MT). Return only the monthly all-India figure for all major ports combined.',
    headlineFilter: (t) => /major\s+ports|all[- ]India\s+ports|cargo/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 50 && v < 100,
    maxArticles: 4,
    maxAgeDays: 45
  },

  cement_dispatches: {
    queryFn: () => 'India cement production dispatches million tonnes April 2026 OR May 2026',
    target: 'the monthly all-India cement production or dispatches in million tonnes. Exclude single-company figures (UltraTech, Ambuja). Return the all-India total.',
    headlineFilter: (t) => /cement/i.test(t) && !/UltraTech|Ambuja|ACC|Shree|Dalmia|earnings|profit/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 25 && v < 60,
    maxArticles: 4,
    maxAgeDays: 45
  },

  air_pax: {
    queryFn: () => 'India domestic air passenger traffic million April 2026 OR May 2026 DGCA',
    target: 'the monthly domestic air passenger traffic for India in millions or lakhs. Headlines may say "X million passengers" or "domestic air traffic of X lakh". Return the monthly figure in millions (1 lakh = 0.1 million).',
    headlineFilter: (t) => /(air\s+passenger|domestic\s+air|DGCA|air\s+traffic)/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 100 && v < 250,
    maxArticles: 4,
    maxAgeDays: 60
  },

  pol_demand: {
    queryFn: () => 'India petroleum products consumption MMT April 2026 OR May 2026 PPAC',
    target: 'monthly all-India petroleum products consumption (total POL demand) in million metric tonnes (MMT or Mn tonnes). Headlines may mention "petroleum demand" or "fuel consumption" with month figures.',
    headlineFilter: (t) => /(petroleum|fuel\s+demand|petroleum\s+products|POL|PPAC)/i.test(t),
    // sourceWhitelist removed -- LLM + plausibility guards quality
    plausible: (v) => v > 15 && v < 30,
    maxArticles: 4,
    maxAgeDays: 45
  }
};

function stripHtml(html) {
  // Aggressive but cheap HTML-to-text: drop scripts/styles, then tags
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function inWhitelist(link, whitelist) {
  if (!whitelist) return true;
  if (!link) return false;
  return whitelist.some(d => link.includes(d));
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No google_news_llm config for ${metric.metric_id}`);

  // Step 1: Google News RSS query
  const q = cfg.queryFn();
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN`;
  const feedRes = await fetchResilient(feedUrl, { timeoutMs: 15000, retries: 1, wayback: false });
  const items = parseRssItems(feedRes.body);
  if (!items.length) throw new Error(`google_news_llm: empty feed for "${q}"`);

  const cutoff = Date.now() - (cfg.maxAgeDays || 45) * 24 * 3600 * 1000;

  // Step 2: pick top N candidates
  const candidates = [];
  for (const it of items) {
    if (!it.title) continue;
    if (cfg.headlineFilter && !cfg.headlineFilter(it.title)) continue;
    // Note: sourceWhitelist applies POST-fetch (since Google News rewrites links via news.google.com).
    const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
    if (Number.isFinite(pub) && pub < cutoff) continue;
    candidates.push(it);
    if (candidates.length >= (cfg.maxArticles || 4)) break;
  }
  if (!candidates.length) throw new Error(`google_news_llm: ${items.length} items, none passed filters`);

  // Step 3+4: fetch each article body, extract via LLM. First plausible wins.
  const errors = [];
  for (const article of candidates) {
    try {
      const articleRes = await fetchArticleBody(article.link, { timeoutMs: 25000 });
      // Apply optional sourceWhitelist now that we have the resolved publisher URL
      if (cfg.sourceWhitelist && !inWhitelist(articleRes.finalUrl, cfg.sourceWhitelist)) {
        errors.push(`${(articleRes.finalUrl||'?').slice(0,60)}: not in source whitelist`);
        continue;
      }
      const bodyText = stripHtml(articleRes.body).slice(0, cfg.maxBodyChars || 6000);
      const prompt = 'Extract: ' + cfg.target +
        '\n\nArticle headline: ' + article.title +
        '\n\nArticle text:\n\n' + bodyText;
      const result = await tryProviders(prompt);

      if (!result || result.value === null || !Number.isFinite(result.value)) {
        errors.push(`${article.link.slice(0,60)}: LLM no value`); continue;
      }

      let value = cfg.valueTransform ? cfg.valueTransform(result.value) : result.value;
      if (!cfg.plausible(value)) {
        errors.push(`${article.link.slice(0,60)}: ${value} out of band`); continue;
      }

      try { recordSnapshot(metric.metric_id, articleRes.finalUrl || article.link, articleRes.body, value, 'google_news_llm_v1'); } catch {}

      return {
        value,
        as_of: article.pubDate ? new Date(article.pubDate).toISOString() : new Date().toISOString(),
        parse_meta: {
          source: 'google-news-llm',
          headline: article.title.slice(0, 240),
          link: article.link,
          final_url: articleRes.finalUrl,
          provider: result.provider,
          source_note: result.source_note
        },
        raw: `${result.provider}: ${result.value} from "${article.title.slice(0,100)}"`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      errors.push(`${article.link?.slice(0,60)}: ${e.message.slice(0,80)}`);
    }
  }
  throw new Error(`${metric.metric_id}: ${candidates.length} candidates, none yielded value · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'google-news-llm-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { stripHtml, inWhitelist };
