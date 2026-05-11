// REAL fetcher · PIB ministry RSS feeds + article-body LLM extraction
//
// PIB (pib.gov.in) is the authoritative source for monthly Indian govt data.
// It blocks foreign IPs but is reachable from the self-hosted India runner.
//
// Strategy:
//   1) Fetch the ministry-specific RSS feed (stable XML format)
//      https://pib.gov.in/Rssfeed.aspx?Mincode=<code>
//   2) Filter recent items by metric keyword
//   3) Fetch each candidate press release body
//   4) Send body to free LLM for value extraction
//
// Ministry codes (Mincode):
//   10 = Ministry of Railways
//   14 = Ministry of Finance (GST, e-way bills, FASTag, UPI revenue)
//   16 = Cabinet (residual)
//   32 = Ministry of Power
//   43 = Ministry of Petroleum & Natural Gas
//   44 = Ministry of Road Transport & Highways (FASTag, NHAI)
//   63 = Ministry of Ports, Shipping & Waterways
//   66 = Ministry of Statistics (MoSPI · IIP, cement)
//   3  = Ministry of Civil Aviation (DGCA)

import { fetchResilient } from '../fetch-resilient.mjs';
import { parseRssItems } from './pib_rss_v1.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { stripHtml } from './google_news_llm_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

// Per-metric config:
//   ministryCodes: PIB Mincode(s) to search RSS feeds of
//   headlineFilter: regex pattern to match relevant release titles
//   target: LLM extraction instruction
//   plausible: range guard
//   maxArticles: how many top matches to try
const CONFIGS = {
  eway_bills: {
    ministryCodes: [14, 16],  // Finance + Cabinet
    headlineFilter: /e[- ]?way\s+bill/i,
    target: 'the absolute monthly count of e-way bills generated in India in crore (count of bills, not value). Returns absolute number only, not percentage change.',
    plausible: (v) => v > 5 && v < 25,
    valueTransform: (v) => v * 10,  // crore -> million
    maxArticles: 4
  },

  fastag_toll: {
    ministryCodes: [44, 14, 16],
    headlineFilter: /(FASTag|toll\s+collection)/i,
    target: 'the monthly FASTag toll collection in India in INR crore. Absolute monthly value, not annual.',
    plausible: (v) => v > 4000 && v < 12000,
    maxArticles: 4
  },

  rail_freight: {
    ministryCodes: [10, 16],  // Railways
    headlineFilter: /(freight\s+loading|freight\s+revenue|Indian\s+Railways)/i,
    target: 'the all-India monthly freight loading of Indian Railways in million tonnes (MT). Exclude zone-specific figures (Central/Western/Northern Railway) and full-year FY totals (1500+ MT range).',
    plausible: (v) => v > 100 && v < 200,
    maxArticles: 4
  },

  port_cargo: {
    ministryCodes: [63, 16],  // Ports
    headlineFilter: /(major\s+ports|cargo)/i,
    target: 'the all-India monthly major ports total cargo throughput in million tonnes (MT). Exclude single-port figures and FY totals (800+ MT).',
    plausible: (v) => v > 50 && v < 100,
    maxArticles: 4
  },

  cement_dispatches: {
    ministryCodes: [66, 16],  // MoSPI
    headlineFilter: /cement/i,
    target: 'the monthly all-India cement production or dispatches in million tonnes. Exclude single-company figures.',
    plausible: (v) => v > 25 && v < 60,
    maxArticles: 4
  },

  pol_demand: {
    ministryCodes: [43, 16],  // Petroleum
    headlineFilter: /(petroleum|fuel\s+consumption|consumption\s+of\s+petroleum)/i,
    target: 'monthly all-India petroleum products consumption (total POL demand) in million metric tonnes (MMT).',
    plausible: (v) => v > 15 && v < 30,
    maxArticles: 4
  },

  wacr_repo_spread: {
    ministryCodes: [14, 16],  // Finance / RBI mentions
    headlineFilter: /(WACR|call\s+rate|monetary\s+policy|liquidity)/i,
    target: 'the difference (spread) in basis points between WACR (Weighted Average Call Rate) and the RBI repo rate. Sign: negative if WACR below repo, positive if above. If article gives WACR % and repo %, compute spread as (WACR - repo) * 100 bps.',
    plausible: (v) => Math.abs(v) <= 200,
    maxArticles: 4
  },

  india_port_dwell_time: {
    ministryCodes: [63, 16],
    headlineFilter: /(dwell|turnaround|port\s+performance)/i,
    target: 'average vessel turnaround time or container dwell time at Indian major ports in days. Most recent monthly or quarterly figure.',
    plausible: (v) => v > 0.5 && v < 10,
    maxArticles: 4
  }
};

const PIB_RSS_BASE = 'https://pib.gov.in/Rssfeed.aspx?Mincode=';

async function getCandidatesForMinistry(ministryCode, headlineFilter, maxAgeDays = 60) {
  const url = `${PIB_RSS_BASE}${ministryCode}`;
  const res = await fetchResilient(url, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
  const items = parseRssItems(res.body);
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
  const out = [];
  for (const it of items) {
    if (!it.title || !headlineFilter.test(it.title)) continue;
    const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
    if (Number.isFinite(pub) && pub < cutoff) continue;
    out.push(it);
  }
  return out;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No pib_search config for ${metric.metric_id}`);

  // Step 1: gather candidates across all configured ministry RSS feeds
  let candidates = [];
  for (const min of cfg.ministryCodes) {
    try {
      const items = await getCandidatesForMinistry(min, cfg.headlineFilter, 60);
      candidates.push(...items);
    } catch (e) {
      // continue to next ministry
    }
  }
  // Dedupe by link
  const seen = new Set();
  candidates = candidates.filter(it => {
    if (!it.link || seen.has(it.link)) return false;
    seen.add(it.link); return true;
  });
  // Sort newest first
  candidates.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
  candidates = candidates.slice(0, cfg.maxArticles || 4);

  if (!candidates.length) {
    throw new Error(`pib_search: no matching PIB releases for ${metric.metric_id} (ministries ${cfg.ministryCodes.join(',')})`);
  }

  const errors = [];
  for (const article of candidates) {
    try {
      const articleRes = await fetchResilient(article.link, {
        timeoutMs: 25000, retries: 1, wayback: false, browserUa: true
      });
      const bodyText = stripHtml(articleRes.body).slice(0, 8000);

      const prompt = 'Extract: ' + cfg.target +
        '\n\nPress release title: ' + article.title +
        '\n\nArticle text:\n\n' + bodyText;
      const result = await tryProviders(prompt);

      if (!result || result.value === null || !Number.isFinite(result.value)) {
        errors.push(`${article.link.slice(0,60)}: LLM no value`); continue;
      }

      let value = cfg.valueTransform ? cfg.valueTransform(result.value) : result.value;
      if (!cfg.plausible(value)) {
        errors.push(`${article.link.slice(0,60)}: ${value} out of band`); continue;
      }

      try { recordSnapshot(metric.metric_id, article.link, articleRes.body, value, 'pib_search_v1'); } catch {}

      return {
        value,
        as_of: article.pubDate ? new Date(article.pubDate).toISOString() : new Date().toISOString(),
        parse_meta: {
          source: 'pib-rss-llm',
          ministries: cfg.ministryCodes,
          title: article.title.slice(0, 240),
          link: article.link,
          provider: result.provider,
          source_note: result.source_note
        },
        raw: `${result.provider}: ${result.value} from "${article.title.slice(0,80)}"`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      errors.push(`${article.link?.slice(0,60)}: ${e.message.slice(0,80)}`);
    }
  }
  throw new Error(`${metric.metric_id}: ${candidates.length} PIB candidates · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'pib-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { getCandidatesForMinistry };
