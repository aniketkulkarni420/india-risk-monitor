// REAL fetcher · PIB India search + article-body LLM extraction
//
// PIB (pib.gov.in) is the authoritative source for monthly Indian govt
// economic data. It blocks foreign IPs but is reachable from the self-hosted
// India runner. This parser:
//
//   1) Searches PIB by keyword + date range
//   2) Pulls first relevant press release URL
//   3) Fetches the release page (regular HTML, format-stable)
//   4) Sends body to free LLM for value extraction
//
// PIB search URL format:
//   https://pib.gov.in/SearchResults.aspx?MenuId=0&Keyword=<query>&Mode=1&Frmdt=&Todt=&Searchby=2&SearchPath=1
//
// PIB press release URL pattern (from search results):
//   https://pib.gov.in/PressReleasePage.aspx?PRID=<id>

import { fetchResilient } from '../fetch-resilient.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { stripHtml } from './google_news_llm_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

// Per-metric config:
//   keyword:    PIB search keyword (URL-encoded automatically)
//   target:     LLM extraction instruction
//   plausible:  range guard
//   maxArticles: how many top search results to try (default 3)
//   valueTransform?: post-extract transform (units etc)
const CONFIGS = {
  eway_bills: {
    keyword: 'E-way bill',
    target: 'the absolute monthly count of e-way bills generated in India for the most recent month, expressed in crore (units of bills, not value in rupees). Headlines or release titles typically say "X crore e-way bills generated in [Month] [Year]". Return only the absolute count, not percentage change.',
    plausible: (v) => v > 5 && v < 25,
    valueTransform: (v) => v * 10,  // crore -> million
    maxArticles: 3
  },

  fastag_toll: {
    keyword: 'FASTag toll collection',
    target: 'the monthly FASTag toll collection in India in INR crore. Returns absolute monthly value, not annual.',
    plausible: (v) => v > 4000 && v < 12000,
    maxArticles: 3
  },

  rail_freight: {
    keyword: 'Indian Railways freight loading',
    target: 'the all-India monthly freight loading of Indian Railways in million tonnes (MT) for the most recent month. Exclude single-zone figures (Central/Western/Northern Railway). Exclude full-year FY totals (those are 1500+ MT range). Return only the monthly all-India figure.',
    plausible: (v) => v > 100 && v < 200,
    maxArticles: 3
  },

  port_cargo: {
    keyword: 'Major ports cargo handled',
    target: 'the monthly all-India major ports total cargo throughput in million tonnes (MT). Exclude single-port figures (JNPA, Mundra). Exclude annual/FY totals (800+ MT range). Return only the monthly all-India figure.',
    plausible: (v) => v > 50 && v < 100,
    maxArticles: 3
  },

  cement_dispatches: {
    keyword: 'Cement production India',
    target: 'the monthly all-India cement production or dispatches in million tonnes. Exclude single-company figures (UltraTech, Ambuja). Return all-India total only.',
    plausible: (v) => v > 25 && v < 60,
    maxArticles: 3
  },

  pol_demand: {
    keyword: 'Petroleum products consumption India',
    target: 'monthly all-India petroleum products consumption (total POL demand) in million metric tonnes (MMT or Mn tonnes).',
    plausible: (v) => v > 15 && v < 30,
    maxArticles: 3
  },

  wacr_repo_spread: {
    // RBI publishes WACR daily via Money Market Operations + monthly bulletin. PIB
    // sometimes covers significant moves. Spread = (WACR - Repo) * 100 bps.
    keyword: 'WACR weighted average call rate',
    target: 'the difference (spread) in basis points between the WACR (Weighted Average Call Rate) and the RBI repo rate, signed. Negative means WACR is below repo, positive means above. If the article gives WACR % and repo %, compute spread as (WACR - repo) * 100 bps. Return only the spread value in basis points (bps).',
    plausible: (v) => Math.abs(v) <= 200,
    maxArticles: 4
  },

  india_port_dwell_time: {
    // Sagarmala / MoPSW occasionally release port dwell time figures via PIB
    keyword: 'Major ports dwell time',
    target: 'average vessel turnaround time or container dwell time at Indian major ports, in days. Returns most recent monthly or quarterly figure.',
    plausible: (v) => v > 0.5 && v < 10,
    maxArticles: 3
  }
};

// Pull first N press-release URLs from a PIB search results page.
function extractPressReleaseLinks(searchHtml, maxN = 3) {
  // PIB search results typically contain: <a href="PressReleasePage.aspx?PRID=XXXXX">...</a>
  const re = /<a[^>]+href="(?:https?:\/\/pib\.gov\.in)?\/?(PressReleasePage\.aspx\?PRID=\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  let m;
  while ((m = re.exec(searchHtml)) !== null && out.length < maxN * 2) {
    const url = m[1].startsWith('http') ? m[1] : `https://pib.gov.in/${m[1]}`;
    const titleText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (titleText.length < 5) continue;
    if (out.some(o => o.url === url)) continue;
    out.push({ url, title: titleText });
    if (out.length >= maxN) break;
  }
  return out;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No pib_search config for ${metric.metric_id}`);

  // Step 1: PIB search
  const searchUrl = `https://pib.gov.in/SearchResults.aspx?MenuId=0&Keyword=${encodeURIComponent(cfg.keyword)}&Mode=1&Frmdt=&Todt=&Searchby=2&SearchPath=1`;
  const searchRes = await fetchResilient(searchUrl, { timeoutMs: 25000, retries: 1, wayback: false, browserUa: true });

  const candidates = extractPressReleaseLinks(searchRes.body, cfg.maxArticles || 3);
  if (!candidates.length) {
    throw new Error(`pib_search: no press release links found for "${cfg.keyword}"`);
  }

  // Step 2-4: fetch each, extract via LLM, first plausible wins
  const errors = [];
  for (const article of candidates) {
    try {
      const articleRes = await fetchResilient(article.url, {
        timeoutMs: 25000, retries: 1, wayback: false, browserUa: true
      });
      const bodyText = stripHtml(articleRes.body).slice(0, 8000);

      const prompt = 'Extract: ' + cfg.target +
        '\n\nPress release title: ' + article.title +
        '\n\nArticle text:\n\n' + bodyText;
      const result = await tryProviders(prompt);

      if (!result || result.value === null || !Number.isFinite(result.value)) {
        errors.push(`${article.url}: LLM no value`); continue;
      }

      let value = cfg.valueTransform ? cfg.valueTransform(result.value) : result.value;
      if (!cfg.plausible(value)) {
        errors.push(`${article.url}: ${value} out of band`); continue;
      }

      try { recordSnapshot(metric.metric_id, article.url, articleRes.body, value, 'pib_search_v1'); } catch {}

      return {
        value,
        as_of: result.as_of ? new Date(result.as_of).toISOString() : new Date().toISOString(),
        parse_meta: {
          source: 'pib-search-llm',
          keyword: cfg.keyword,
          title: article.title.slice(0, 200),
          url: article.url,
          provider: result.provider,
          source_note: result.source_note
        },
        raw: `${result.provider}: ${result.value} from "${article.title.slice(0,80)}"`
      };
    } catch (e) {
      if (e.code === 'LLM_UNAVAILABLE') throw e;
      errors.push(`${article.url}: ${e.message.slice(0,80)}`);
    }
  }
  throw new Error(`${metric.metric_id}: ${candidates.length} PIB articles tried · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'pib-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { extractPressReleaseLinks };
