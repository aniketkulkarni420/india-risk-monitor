// REAL fetcher · Publisher-direct topic RSS feeds (industry trade pubs).
//
// Trade publications (Construction World, Indian Cement Review, Logistics India,
// Maritime Gateway, ET Infra) have stable topic RSS feeds with publisher URLs
// (NOT Google News redirects). Article descriptions often have first-paragraph
// content including monthly absolute figures.
//
// Same alternative content to Magzter but free + scrape-friendly.

import { fetchResilient } from '../fetch-resilient.mjs';
import { parseRssItems } from './pib_rss_v1.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { stripHtml } from './google_news_llm_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

// Per-metric: { feeds, target, plausible, valueTransform?, maxArticles, maxAgeDays }
const CONFIGS = {
  cement_dispatches: {
    feeds: [
      'https://www.constructionworld.in/rss',
      'https://www.indiancementreview.com/feed/',
      'https://www.financialexpress.com/rss/economy.xml',
      'https://www.business-standard.com/rss/companies-101.rss'
    ],
    headlineFilter: /(cement|production|dispatches?)/i,
    target: 'The all-India monthly cement production or dispatches in million tonnes. Exclude single-company figures (UltraTech, Ambuja, ACC). Typical 30-45 MT. Return absolute monthly value only.',
    plausible: (v) => v > 25 && v < 60,
    maxArticles: 5,
    maxAgeDays: 60
  },

  rail_freight: {
    feeds: [
      'https://www.logisticsindia.in/feed/',
      'https://www.financialexpress.com/rss/infrastructure.xml',
      'https://www.business-standard.com/rss/economy-policy-103.rss'
    ],
    headlineFilter: /(railway|freight|loading)/i,
    target: 'The all-India monthly freight loading of Indian Railways in million tonnes (MT). Typical 120-160 MT. Exclude single-zone (Central/Western/Northern Railway) and FY totals (1500+ MT).',
    plausible: (v) => v > 100 && v < 200,
    maxArticles: 5,
    maxAgeDays: 60
  },

  port_cargo: {
    feeds: [
      'https://www.maritimegateway.com/feed/',
      'https://www.logisticsindia.in/feed/',
      'https://www.financialexpress.com/rss/infrastructure.xml'
    ],
    headlineFilter: /(port|cargo|traffic)/i,
    target: 'The all-India monthly TOTAL cargo throughput across all 12 major ports combined, in million tonnes (MT). Typical 60-90 MT. Exclude single ports (JNPA, Mundra) and FY totals (800+ MT).',
    plausible: (v) => v > 50 && v < 100,
    maxArticles: 5,
    maxAgeDays: 60
  },

  fastag_toll: {
    feeds: [
      'https://www.constructionworld.in/rss',
      'https://www.financialexpress.com/rss/infrastructure.xml',
      'https://www.business-standard.com/rss/economy-policy-103.rss'
    ],
    headlineFilter: /(FASTag|toll|NHAI)/i,
    target: 'The monthly FASTag toll collection in India in INR crore. Typical 5000-10000 Cr/month. Exclude annual totals (50000+ Cr) or pass-pricing news.',
    plausible: (v) => v > 4000 && v < 12000,
    maxArticles: 5,
    maxAgeDays: 60
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No publisher_rss_v1 config for ${metric.metric_id}`);

  const cutoff = Date.now() - (cfg.maxAgeDays || 60) * 24 * 3600 * 1000;
  let candidates = [];

  // Gather articles across all feeds
  for (const feed of cfg.feeds) {
    try {
      const res = await fetchResilient(feed, { timeoutMs: 15000, retries: 1, wayback: false, browserUa: true });
      const items = parseRssItems(res.body);
      for (const it of items) {
        if (!it.title || !cfg.headlineFilter.test(it.title)) continue;
        const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
        if (Number.isFinite(pub) && pub < cutoff) continue;
        if (!it.link || candidates.some(c => c.link === it.link)) continue;
        candidates.push(it);
      }
    } catch { /* try next feed */ }
  }

  candidates.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
  candidates = candidates.slice(0, cfg.maxArticles || 5);

  if (!candidates.length) {
    throw new Error(`publisher_rss_v1: no matching articles across ${cfg.feeds.length} feeds`);
  }

  const errors = [];
  // Fire article-LLM extractions in parallel
  const settled = await Promise.allSettled(candidates.map(async (a) => {
    try {
      const articleRes = await fetchResilient(a.link, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
      const bodyText = stripHtml(articleRes.body).slice(0, 7000);
      const prompt = 'Extract: ' + cfg.target +
        '\n\nArticle headline: ' + a.title +
        '\n\nArticle text:\n\n' + bodyText;
      const r = await tryProviders(prompt);
      if (!r || r.value === null || !Number.isFinite(r.value)) {
        return { failed: true, reason: `${a.link.slice(0,60)}: LLM no value` };
      }
      let value = cfg.valueTransform ? cfg.valueTransform(r.value) : r.value;
      if (!cfg.plausible(value)) {
        return { failed: true, reason: `${a.link.slice(0,60)}: ${value} out of band` };
      }
      try { recordSnapshot(metric.metric_id, a.link, articleRes.body, value, 'publisher_rss_v1'); } catch {}
      return {
        success: true,
        result: {
          value,
          as_of: a.pubDate ? new Date(a.pubDate).toISOString() : new Date().toISOString(),
          parse_meta: { source: 'publisher-rss', link: a.link, headline: a.title.slice(0, 200), provider: r.provider },
          raw: `${r.provider}: ${value} from "${a.title.slice(0,80)}"`
        }
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      return { failed: true, reason: `${a.link?.slice(0,60)}: ${e.message.slice(0,80)}` };
    }
  }));

  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value.success) return s.value.result;
    if (s.status === 'fulfilled') errors.push(s.value.reason);
    else { if (s.reason?.code === 'LLM_UNAVAILABLE') throw s.reason; errors.push(String(s.reason).slice(0, 120)); }
  }

  throw new Error(`publisher_rss_v1: ${candidates.length} articles tried · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'publisher-rss-crosscheck-pending', parse_meta: { source: 'pending' } };
}
