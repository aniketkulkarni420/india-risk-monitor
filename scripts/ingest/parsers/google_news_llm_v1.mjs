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
import { getSharedBrowser } from '../browser-pool.mjs';
const getBrowser = getSharedBrowser;

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
    queryFn: () => 'India e-way bills generated crore monthly',
    target: 'The absolute monthly count of e-way bills generated in India for the most recent month. Required units: crore (count of bills, NOT rupees value, NOT cumulative). Typical range: 8-15 crore per month. Example: "10.5 crore e-way bills were generated in April 2026" -> return 10.5. If text only gives percentage change without absolute count, return null. Reject any value above 25 crore (those are likely cumulative annual totals).',
    headlineFilter: (t) => /e[- ]?way\s+bill/i.test(t),
    valueTransform: (v) => v * 10,                  // crore -> million
    plausible: (v) => v > 50 && v < 250,            // post-transform: million bills
    maxArticles: 5,
    maxAgeDays: 60
  },

  fastag_toll: {
    queryFn: () => 'FASTag',  // simpler query gets more results
    target: 'The monthly FASTag toll collection amount for India in INR crore for the most recent month. Required: monthly figure between 5000 and 12000 crore. Example: "Toll collection via FASTag reached Rs 6,500 crore in April 2026" -> return 6500. Reject: annual totals (50000+ crore), pass prices, or any value outside 5000-12000 crore range.',
    headlineFilter: null,  // let LLM judge from body
    plausible: (v) => v > 4000 && v < 12000,
    maxArticles: 6,
    maxAgeDays: 120
  },

  rail_freight: {
    queryFn: () => 'Indian Railways freight',
    target: 'The ALL-INDIA monthly freight loading by Indian Railways in million tonnes (MT). Typical monthly range: 120-160 MT. STRICT EXCLUSIONS: (1) single zone figures (Central/Western/Northern/Southern/Eastern Railway -- those are 5-10 MT range); (2) full FY/year totals (those are 1500-1800 MT range, like "1670 MT in FY26"); (3) freight REVENUE in crore (that is rupees, not tonnes). Return only the absolute monthly all-India tonnage between 100 and 200 MT.',
    headlineFilter: null,
    plausible: (v) => v > 100 && v < 200,
    maxArticles: 6,
    maxAgeDays: 120
  },

  port_cargo: {
    queryFn: () => 'India major ports cargo',
    target: 'The all-India monthly TOTAL cargo throughput across all 12 major ports combined, in million tonnes (MT). Typical monthly range: 60-90 MT. STRICT EXCLUSIONS: (1) single port figures (JNPA, Mundra, Chennai, Paradip alone -- those are 5-15 MT); (2) annual/FY totals (those are 750-950 MT range like "915 MT in FY26"); (3) container count in TEU (different unit). Return only the monthly aggregate.',
    headlineFilter: null,
    plausible: (v) => v > 50 && v < 100,
    maxArticles: 6,
    maxAgeDays: 120
  },

  cement_dispatches: {
    queryFn: () => 'India cement production dispatches million tonnes monthly',
    target: 'The all-India monthly cement production or dispatches in million tonnes (MT). Typical monthly range: 30-45 MT. STRICT EXCLUSIONS: (1) single-company figures (UltraTech, Ambuja, ACC alone -- those are 4-12 MT); (2) annual/FY totals (those are 350-450 MT range); (3) capacity figures (those are 600+ MT range like "200 MTPA capacity"). Return only the monthly all-India production.',
    headlineFilter: (t) => /cement/i.test(t) && !/UltraTech|Ambuja|ACC|Shree|Dalmia|earnings|profit|capacity|MTPA/i.test(t),
    plausible: (v) => v > 25 && v < 60,
    maxArticles: 5,
    maxAgeDays: 60
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
    queryFn: () => 'India fuel consumption diesel petrol monthly demand',
    target: 'The all-India monthly TOTAL petroleum products consumption (sum of diesel + petrol + LPG + ATF + others) in million metric tonnes (MMT). Typical monthly range: 18-25 MMT. STRICT EXCLUSIONS: (1) single-product figures (only diesel, only petrol -- those are 3-9 MMT); (2) annual/FY totals (220-260 MMT range); (3) crude oil throughput at refineries (different metric, 20-23 MMT range but distinct). Return only the monthly aggregate consumption.',
    headlineFilter: (t) => /(petroleum|fuel|diesel|petrol|consumption)/i.test(t),
    plausible: (v) => v > 15 && v < 30,
    maxArticles: 6,
    maxAgeDays: 90
  },

  wacr_repo_spread: {
    queryFn: () => 'WACR weighted average call rate repo bps India May 2026',
    target: 'the difference (spread) in basis points between WACR (Weighted Average Call Rate) and the RBI repo rate. Sign convention: negative if WACR below repo, positive if above. If the article gives both WACR % and repo %, compute spread as (WACR - repo) * 100. Return only the bps value.',
    headlineFilter: (t) => /(WACR|call\s+rate|repo|liquidity)/i.test(t),
    plausible: (v) => Math.abs(v) <= 200,
    maxArticles: 5,
    maxAgeDays: 90
  },

  india_port_dwell_time: {
    queryFn: () => 'India major ports turnaround time vessel dwell days 2026',
    target: 'average vessel turnaround time or container dwell time at Indian major ports in days. Most recent monthly or quarterly figure.',
    headlineFilter: (t) => /(dwell|turnaround|port\s+performance|vessel)/i.test(t),
    plausible: (v) => v > 0.5 && v < 10,
    maxArticles: 4,
    maxAgeDays: 120
  },

  fno_oi_buildup: {
    queryFn: () => 'Nifty open interest',
    target: 'Nifty futures/options Open Interest (OI) build-up percentage change or absolute count for recent trading days. Sign matters: negative = OI declining, positive = OI building. Prefer % change figure if both available.',
    headlineFilter: null,
    plausible: (v) => Math.abs(v) < 1000000,
    maxArticles: 5,
    maxAgeDays: 30
  },

  block_deals_notional: {
    queryFn: () => 'NSE block deals',
    target: 'the daily total notional value of all NSE/BSE block deals in INR crore for most recent trading day.',
    headlineFilter: null,
    plausible: (v) => v > 0 && v < 50000,
    maxArticles: 5,
    maxAgeDays: 30
  },

  fpi_debt_flows: {
    queryFn: () => 'India FPI FII debt investment month MTD crore',
    target: 'most recent FPI/FII Debt (bond/G-Sec) net investment for India in INR crore. Can be positive (inflow) or negative (outflow). Return month-to-date (MTD) figure.',
    headlineFilter: (t) => /(FPI|FII|debt\s+flow|debt\s+investment|bond)/i.test(t),
    plausible: (v) => Math.abs(v) < 200000,
    maxArticles: 4,
    maxAgeDays: 30
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
    if (cfg.headlineFilter !== null && cfg.headlineFilter && !cfg.headlineFilter(it.title)) continue;
    const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
    if (Number.isFinite(pub) && pub < cutoff) continue;
    candidates.push(it);
    if (candidates.length >= (cfg.maxArticles || 4)) break;
  }
  if (!candidates.length) throw new Error(`google_news_llm: ${items.length} items, none passed filters`);

  // Step 3+4: fetch each article body + extract via LLM IN PARALLEL.
  // Tier A optimization: ~5x faster than sequential when 4+ candidates.
  const errors = [];
  const fetchedArticles = [];

  async function processArticle(article) {
    try {
      const articleRes = await fetchArticleBody(article.link, { timeoutMs: 25000 });
      if (cfg.sourceWhitelist && !inWhitelist(articleRes.finalUrl, cfg.sourceWhitelist)) {
        return { failed: true, reason: `not in whitelist: ${(articleRes.finalUrl||'?').slice(0,60)}` };
      }
      const bodyText = stripHtml(articleRes.body).slice(0, cfg.maxBodyChars || 6000);
      const captured = { headline: article.title, body: bodyText, link: articleRes.finalUrl || article.link, pubDate: article.pubDate };

      const prompt = 'Extract: ' + cfg.target +
        '\n\nArticle headline: ' + article.title +
        '\n\nArticle text:\n\n' + bodyText;
      const result = await tryProviders(prompt);

      if (!result || result.value === null || !Number.isFinite(result.value)) {
        return { failed: true, captured, reason: `${article.link.slice(0,60)}: LLM no value` };
      }
      let value = cfg.valueTransform ? cfg.valueTransform(result.value) : result.value;
      if (!cfg.plausible(value)) {
        return { failed: true, captured, reason: `${article.link.slice(0,60)}: ${value} out of band` };
      }
      try { recordSnapshot(metric.metric_id, articleRes.finalUrl || article.link, articleRes.body, value, 'google_news_llm_v1'); } catch {}
      return {
        success: true,
        captured,
        result: {
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
        }
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      return { failed: true, reason: `${article.link?.slice(0,60)}: ${e.message.slice(0,80)}` };
    }
  }

  // Fire all candidate-article extractions in parallel
  const settled = await Promise.allSettled(candidates.map(processArticle));
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const r = s.value;
      if (r.captured) fetchedArticles.push(r.captured);
      if (r.success) {
        return r.result;
      }
      if (r.reason) errors.push(r.reason);
    } else {
      if (s.reason?.code === 'LLM_UNAVAILABLE') throw s.reason;
      errors.push(String(s.reason).slice(0, 120));
    }
  }

  // Fallback: concatenate all fetched articles and ask LLM to pick the right one
  if (fetchedArticles.length >= 2) {
    try {
      const combined = fetchedArticles.map((a, i) =>
        `--- Article ${i+1} ---\nHeadline: ${a.headline}\nText: ${a.body.slice(0, 3000)}`
      ).join('\n\n');
      const prompt = 'Extract: ' + cfg.target +
        `\n\nBelow are ${fetchedArticles.length} candidate articles. ONE of them likely contains the value. Find the article that explicitly mentions the absolute monthly value (not percentage change, not annual total). If NONE of the articles contains the absolute monthly value, return { "value": null, ... }.\n\n` +
        combined;
      const r = await tryProviders(prompt);
      if (r && r.value !== null && Number.isFinite(r.value)) {
        let value = cfg.valueTransform ? cfg.valueTransform(r.value) : r.value;
        if (cfg.plausible(value)) {
          return {
            value,
            as_of: r.as_of ? new Date(r.as_of).toISOString() : new Date().toISOString(),
            parse_meta: {
              source: 'google-news-llm-multi',
              articles_count: fetchedArticles.length,
              provider: r.provider,
              source_note: r.source_note
            },
            raw: `${r.provider} (multi-doc): ${r.value}`
          };
        }
        errors.push(`multi-doc: ${value} out of band`);
      } else {
        errors.push(`multi-doc: LLM no value across ${fetchedArticles.length} articles`);
      }
    } catch (e) {
      errors.push(`multi-doc: ${(e.message||'').slice(0,80)}`);
    }
  }

  throw new Error(`${metric.metric_id}: ${candidates.length} candidates, none yielded value · ${errors.slice(0,3).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'google-news-llm-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { stripHtml, inWhitelist };
