// REAL fetcher · BSE block deals + FII flows · Playwright-backed
//
// BSE pages are reachable but JS-renders the data table. Use Playwright.

import { recordSnapshot } from '../snapshot-store.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let _bp = null;
async function getBrowser() {
  if (!_bp) {
    let pw; try { pw = require('playwright'); } catch { return null; }
    _bp = pw.chromium.launch({ headless: true, args: ['--disable-http2','--disable-blink-features=AutomationControlled'] });
  }
  return _bp;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONFIGS = {
  block_deals_notional: {
    urls: [
      'https://www.bseindia.com/markets/equity/EQReports/BlockDeals.aspx',
      'https://www.bseindia.com/markets/equity/EQReports/blkdealRPT.aspx'
    ],
    waitSelector: 'table, .tabbed_box',
    waitMs: 6000,
    // BSE shows tabular block deals. Sum notional or use "total" cell.
    extractRe: /(?:Total|Sum)[\s\S]{0,200}?(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:crore|Cr)?/i,
    plausible: (v) => v > 0 && v < 50000,
    valueParser: (s) => parseFloat(String(s).replace(/,/g, '')),
    timeoutMs: 45000
  },
  fpi_debt_flows: {
    urls: [
      'https://www.bseindia.com/markets/equity/EQReports/FII_InvestmentReport.aspx'
    ],
    waitSelector: 'table',
    waitMs: 6000,
    extractRe: /Debt[\s\S]{0,400}?(-?[\d,]+(?:\.\d+)?)/i,
    plausible: (v) => Math.abs(v) < 200000,
    valueParser: (s) => parseInt(String(s).replace(/,/g, ''), 10),
    timeoutMs: 45000
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No bse_v1 config for ${metric.metric_id}`);
  const browser = await getBrowser();
  if (!browser) throw new Error('bse_v1: playwright not installed');
  const b = await browser;
  const ctx = await b.newContext({ userAgent: UA, locale: 'en-IN', viewport: { width: 1280, height: 800 } });
  const errors = [];
  try {
    for (const url of cfg.urls) {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: cfg.timeoutMs || 35000 });
        if (cfg.waitSelector) { try { await page.waitForSelector(cfg.waitSelector, { timeout: 12000 }); } catch {} }
        if (cfg.waitMs) await page.waitForTimeout(cfg.waitMs);
        const html = await page.content();
        const m = html.match(cfg.extractRe);
        if (!m) { errors.push(`${url}: regex no match`); continue; }
        const value = cfg.valueParser ? cfg.valueParser(m[1]) : parseFloat(m[1]);
        if (!Number.isFinite(value) || !cfg.plausible(value)) {
          errors.push(`${url}: ${value} implausible`); continue;
        }
        try { recordSnapshot(metric.metric_id, url, html, value, 'bse_v1'); } catch {}
        return { value, as_of: new Date().toISOString(), parse_meta: { source: 'bse', url }, raw: m[0].slice(0,200) };
      } catch (e) { errors.push(`${url}: ${(e.message||'').slice(0,80)}`); }
      finally { await page.close().catch(()=>{}); }
    }
  } finally { await ctx.close().catch(()=>{}); }
  throw new Error(`bse_v1: all ${cfg.urls.length} URLs failed · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'bse-crosscheck-pending', parse_meta: { source: 'pending' } };
}
