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
  gift_nifty: {
    // GIFT Nifty (NSE IX) — pre-open/overnight India signal. No free JSON API
    // exists (NSE IX is a JS SPA, Yahoo doesn't carry it) — render a quote page.
    sources: [
      {
        url: 'https://www.moneycontrol.com/indian-indices/gift-nifty-141.html',
        target: 'the CURRENT/LAST traded price of GIFT Nifty (the index futures level, a number around 20000-27000). Return only the level, not the change.',
        waitMs: 6000
      },
      {
        url: 'https://groww.in/indices/gift-nifty',
        target: 'the current GIFT Nifty level (number around 20000-27000).',
        waitMs: 6000
      }
    ],
    plausible: (v) => v > 15000 && v < 35000
  },

  nifty_pcr: {
    // Fallback when the NSE option-chain API is bot-blocked. These pages
    // display the OI-based PCR directly.
    sources: [
      {
        url: 'https://www.niftytrader.in/nse-option-chain/nifty',
        target: 'the Nifty Put-Call Ratio (PCR) based on open interest shown on the page. A number between 0.3 and 3, e.g. 0.92.',
        waitMs: 7000
      },
      {
        url: 'https://upstox.com/option-chain/nifty/',
        target: 'the Nifty PCR (put call ratio, OI-based) shown on the page — a number between 0.3 and 3.',
        waitMs: 7000
      }
    ],
    plausible: (v) => v > 0.3 && v < 3
  },

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
    // 2026-05-12: dropped IRB (quarterly cadence mismatch). Replaced with NHAI + PIB MoRTH monthly sources.
    sources: [
      {
        url: 'https://en.wikipedia.org/wiki/FASTag',
        target: 'the most recent monthly FASTag toll collection figure in India in INR crore. Wikipedia often has a "Statistics" or "Collection" section with a table. Return the latest monthly value.',
        waitMs: 3000
      },
      {
        url: 'https://nhai.gov.in/nhai/en/major-achievements',
        target: 'most recent monthly FASTag toll collection figure for India in INR crore from NHAI page. Return absolute monthly value, not annual.',
        waitMs: 5000
      },
      {
        url: 'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=44',
        target: 'most recent monthly FASTag toll collection figure from PIB MoRTH press releases. Return absolute monthly value in INR crore.',
        waitMs: 4000
      }
    ],
    plausible: (v) => v > 4000 && v < 12000
  },

  rail_freight: {
    // 2026-05-12: dropped CONCOR (quarterly cadence). Replaced with PIB Railway + IR official stat page.
    sources: [
      {
        url: 'https://en.wikipedia.org/wiki/Indian_Railways',
        target: 'most recent monthly freight loading of Indian Railways in million tonnes (MT). All-India figure, NOT zone-specific. Typical 120-160 MT/month. Reject FY totals (1500-1800 MT) and zone-specific.',
        waitMs: 3000
      },
      {
        url: 'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=10',
        target: 'most recent monthly all-India freight loading by Indian Railways in MT from PIB Ministry of Railways press release. Absolute monthly value only.',
        waitMs: 4000
      },
      {
        url: 'https://www.indianrailways.gov.in/railwayboard/uploads/directorate/stat_econ/Outlook/Index_Statistics.html',
        target: 'monthly all-India freight loading figure in million tonnes from IR Statistical Economics page. Latest month only.',
        waitMs: 4000
      }
    ],
    plausible: (v) => v > 100 && v < 200
  },

  port_cargo: {
    // Phase 1 addition (2026-05-12): port_cargo now in web_llm_v1.
    // Dropped CONCOR (quarterly). Added Adani Ports (monthly BSE disclosure) + PIB Ports.
    sources: [
      {
        url: 'https://www.adaniports.com/Investors/Investor-Information',
        target: 'most recent monthly cargo volume disclosure from Adani Ports in million metric tonnes (MMT). Adani operates ~30% of India major port volume — a strong proxy. Return absolute monthly Adani Ports cargo volume.',
        waitMs: 6000
      },
      {
        url: 'https://en.wikipedia.org/wiki/Major_ports_of_India',
        target: 'most recent monthly TOTAL cargo throughput across all 12 major ports of India in million tonnes (MT). Typical 60-90 MT/month. Reject single-port figures and FY totals.',
        waitMs: 3000
      },
      {
        url: 'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=63',
        target: 'most recent monthly all-India major ports total cargo throughput from PIB Ministry of Ports press release. Absolute monthly value, not FY totals.',
        waitMs: 4000
      }
    ],
    plausible: (v) => v > 50 && v < 100
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
