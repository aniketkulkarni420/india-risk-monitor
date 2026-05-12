// REAL fetcher · Generic Playwright + LLM extractor.
//
// Takes a URL list + target prompt from per-metric config. For each URL:
//   1) Playwright loads the page (handles JS rendering)
//   2) Strip HTML to text
//   3) Free LLM extracts the target value
// First plausible value wins.
//
// Use case: any aggregator/broker site that has the data on a public page
// but is JS-rendered. Trendlyne, Tickertape, Moneycontrol, IRB, CONCOR etc.

import { recordSnapshot } from '../snapshot-store.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { stripHtml } from './google_news_llm_v1.mjs';
import { getSharedBrowser } from '../browser-pool.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Per-metric: list of (url, target, plausible) configs. First plausible wins.
const CONFIGS = {
  block_deals_notional: {
    sources: [
      {
        url: 'https://www.trendlyne.com/markets-today/today-block-deals-india/',
        target: 'the total notional value (in INR crore) of ALL block deals shown on the page for the most recent trading day. Sum the value column. Return only the sum.',
        waitMs: 6000
      },
      {
        url: 'https://economictimes.indiatimes.com/markets/stocks/recos/block-deals',
        target: 'total notional value of NSE/BSE block deals in INR crore for the most recent trading day shown.',
        waitMs: 5000
      }
    ],
    plausible: (v) => v > 0 && v < 50000
  },

  fastag_toll: {
    sources: [
      {
        url: 'https://en.wikipedia.org/wiki/FASTag',
        target: 'the most recent monthly FASTag toll collection figure in India in INR crore. Wikipedia often has a "Statistics" or "Collection" section with a table. Return the latest monthly value.',
        waitMs: 3000
      },
      {
        url: 'https://www.irb.co.in/investor/financial-information.html',
        target: 'most recent monthly national FASTag toll collection figure in INR crore, often quoted in IRB investor presentations as industry context. Return the absolute monthly value, not a percentage or growth rate.',
        waitMs: 6000
      }
    ],
    plausible: (v) => v > 4000 && v < 12000
  },

  rail_freight: {
    sources: [
      {
        url: 'https://en.wikipedia.org/wiki/Indian_Railways',
        target: 'most recent monthly freight loading of Indian Railways in million tonnes (MT). All-India figure, NOT a zone-specific subset. Typical range 120-160 MT/month. Reject FY totals (1500-1800 MT range) and zone-specific numbers.',
        waitMs: 3000
      },
      {
        url: 'https://www.concorindia.co.in/financial-information.aspx',
        target: 'in CONCOR investor presentation, the system-wide Indian Railways monthly freight loading figure in million tonnes (MT). Return the absolute monthly value.',
        waitMs: 6000
      }
    ],
    plausible: (v) => v > 100 && v < 200
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No web_llm_v1 config for ${metric.metric_id}`);
  const b = await getSharedBrowser();
  if (!b) throw new Error('playwright not installed');
  const ctx = await b.newContext({ userAgent: UA, locale: 'en-IN', viewport: { width: 1280, height: 800 } });
  const errors = [];
  try {
    for (const src of cfg.sources) {
      const page = await ctx.newPage();
      try {
        await page.goto(src.url, { waitUntil: 'networkidle', timeout: 35000 });
        if (src.waitMs) await page.waitForTimeout(src.waitMs);
        const html = await page.content();
        const text = stripHtml(html).slice(0, 14000);
        const prompt = 'Extract: ' + src.target + '\n\nPage URL: ' + src.url + '\n\nPage text:\n\n' + text;
        const r = await tryProviders(prompt);
        if (!r || r.value === null || !Number.isFinite(r.value)) {
          errors.push(`${src.url.slice(0,60)}: LLM no value`); continue;
        }
        const value = r.value;
        if (!cfg.plausible(value)) { errors.push(`${src.url.slice(0,60)}: ${value} out of band`); continue; }
        try { recordSnapshot(metric.metric_id, src.url, html, value, 'web_llm_v1'); } catch {}
        return {
          value,
          as_of: r.as_of ? new Date(r.as_of).toISOString() : new Date().toISOString(),
          parse_meta: { source: 'web-llm', url: src.url, provider: r.provider, source_note: r.source_note },
          raw: `${r.provider}: ${value} from ${src.url}`
        };
      } catch (e) {
        if (e.code === 'LLM_UNAVAILABLE') throw e;
        errors.push(`${src.url.slice(0,60)}: ${(e.message||'').slice(0,80)}`);
      } finally { await page.close().catch(()=>{}); }
    }
  } finally { await ctx.close().catch(()=>{}); }
  throw new Error(`web_llm_v1: all ${cfg.sources.length} sources failed · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'web-llm-crosscheck-pending', parse_meta: { source: 'pending' } };
}
