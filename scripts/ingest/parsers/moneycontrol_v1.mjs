// REAL fetcher · Moneycontrol scrape · Playwright + LLM extraction.
//
// Strategy: Playwright renders the page (handles JS), strip to text,
// send to free LLM with metric-specific extraction target. Far more
// resilient than regex against an SPA that may restructure.

import { recordSnapshot } from '../snapshot-store.mjs';
import { tryProviders } from './llm_extract_v1.mjs';
import { stripHtml } from './google_news_llm_v1.mjs';
import { getSharedBrowser } from '../browser-pool.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONFIGS = {
  fpi_debt_flows: {
    urls: ['https://www.moneycontrol.com/stocks/marketstats/fii_fpi.php'],
    target: 'the most recent FPI Debt net investment value for India in INR crore. Page shows daily and monthly tables. Return the latest month-to-date (MTD) net Debt investment value (can be negative for outflows).',
    plausible: (v) => Math.abs(v) < 200000,
    waitMs: 5000
  },

  block_deals_notional: {
    urls: ['https://www.moneycontrol.com/stocks/marketstats/bulkblockdeals.php'],
    target: 'the most recent daily total notional value of all block deals on NSE/BSE in INR crore. Sum across the visible block deals table for the latest date.',
    plausible: (v) => v > 0 && v < 50000,
    waitMs: 5000
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No moneycontrol_v1 config for ${metric.metric_id}`);
  const b = await getSharedBrowser();
  if (!b) throw new Error('moneycontrol_v1: playwright not installed');
  const ctx = await b.newContext({ userAgent: UA, locale: 'en-IN', viewport: { width: 1280, height: 800 } });
  const errors = [];
  try {
    for (const url of cfg.urls) {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
        if (cfg.waitMs) await page.waitForTimeout(cfg.waitMs);
        const html = await page.content();
        const text = stripHtml(html).slice(0, 12000);

        const prompt = 'Extract: ' + cfg.target + '\n\nPage URL: ' + url + '\n\nPage text:\n\n' + text;
        const result = await tryProviders(prompt);
        if (!result || result.value === null || !Number.isFinite(result.value)) {
          errors.push(`${url}: LLM no value`); continue;
        }
        const value = result.value;
        if (!cfg.plausible(value)) { errors.push(`${url}: ${value} out of band`); continue; }

        try { recordSnapshot(metric.metric_id, url, html, value, 'moneycontrol_v1'); } catch {}
        return {
          value,
          as_of: result.as_of ? new Date(result.as_of).toISOString() : new Date().toISOString(),
          parse_meta: { source: 'moneycontrol-llm', url, provider: result.provider, source_note: result.source_note },
          raw: `${result.provider}: ${result.value}`
        };
      } catch (e) {
        if (e.code === 'LLM_UNAVAILABLE') throw e;
        errors.push(`${url}: ${(e.message||'').slice(0,80)}`);
      } finally { await page.close().catch(()=>{}); }
    }
  } finally { await ctx.close().catch(()=>{}); }
  throw new Error(`moneycontrol_v1: all ${cfg.urls.length} URLs failed · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'moneycontrol-crosscheck-pending', parse_meta: { source: 'pending' } };
}
