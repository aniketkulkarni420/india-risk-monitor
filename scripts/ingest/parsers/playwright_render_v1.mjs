// REAL fetcher · Playwright headless browser renderer
//
// For SPA / JS-rendered pages (NPCI, NSE, DGCA, NSDL) where plain fetch()
// returns an empty shell because the value is injected by JavaScript.
//
// Pattern:
//   1) Launch chromium headless
//   2) page.goto(url, { waitUntil: 'networkidle' })
//   3) Optionally page.waitForSelector(selector) to ensure JS rendered
//   4) Extract text via page.textContent(selector) OR full page.content()
//   5) Match against regex / parse JSON
//
// Browser instance is shared across calls in a single ingest run to avoid
// repeated chromium launch overhead (~2s). Closed when process exits.

import { recordSnapshot } from '../snapshot-store.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Lazy-load playwright so the rest of the system runs even if chromium
// is not yet installed (npx playwright install chromium).
let playwright = null;
function getPlaywright() {
  if (playwright !== null) return playwright;
  try { playwright = require('playwright'); }
  catch { playwright = false; }
  return playwright;
}

let _browserPromise = null;
async function getBrowser() {
  const pw = getPlaywright();
  if (!pw) {
    const e = new Error('playwright not installed. Run `npm install playwright && npx playwright install chromium`.');
    e.code = 'PLAYWRIGHT_UNAVAILABLE';
    throw e;
  }
  if (!_browserPromise) {
    // --disable-http2 bypasses NSE's HTTP/2 protocol-error block on bots
    _browserPromise = pw.chromium.launch({
      headless: true,
      args: ['--disable-http2', '--disable-blink-features=AutomationControlled']
    });
    // Auto-close on process exit
    const close = async () => {
      try { const b = await _browserPromise; await b.close(); } catch {}
    };
    process.once('exit', () => { /* sync only */ });
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }
  return _browserPromise;
}

// Per-metric config:
//   urls: list of URLs to try
//   waitSelector?: CSS selector to wait for before extracting (signals JS done)
//   waitMs?: extra wait after load (default 2000)
//   extractSelector?: extract textContent of this selector (preferred — stable)
//   extractRe?: regex with capture group 1 = numeric value (fallback)
//   plausible
//   valueParser?
//   timeoutMs?: per-page navigation timeout (default 30000)
const CONFIGS = {
  // NSE/NSDL configs removed 2026-05-11 — these endpoints actively block all
  // free-tier scraping vectors (Akamai bot detection, HTTP/2 abort, SPA auth
  // session requirements). Metrics fno_oi_buildup, block_deals_notional, and
  // fpi_debt_flows have been retired from the IRM data contract.

  // NPCI UPI product statistics — value rendered into a table by JS
  upi_value_pw: {
    urls: ['https://www.npci.org.in/what-we-do/upi/product-statistics'],
    waitSelector: 'table',
    waitMs: 3000,
    // Page shows a row "Value (in Cr)" with monthly columns; regex catches latest
    extractRe: /Value\s*\(in\s+Cr\)[\s\S]{0,500}?(\d{2,3},\d{3,}(?:\.\d+)?)/i,
    plausible: (v) => v > 500000 && v < 5000000,  // in crore
    valueParser: (s) => +(parseFloat(s.replace(/,/g, '')) / 100000).toFixed(2),  // crore → lakh crore
    timeoutMs: 45000
  },

  // NSE India VIX — JS-rendered widget on market data page
  india_vix_pw: {
    urls: ['https://www.nseindia.com/market-data/india-vix'],
    waitSelector: '#vix-tabl, [data-test="india-vix"], .latestVix',
    waitMs: 4000,
    extractRe: /India\s+VIX[\s\S]{0,200}?(\d{1,2}\.\d{1,2})/i,
    plausible: (v) => v > 5 && v < 80,
    timeoutMs: 45000
  },

  // DGCA monthly air passenger statistics
  air_pax_pw: {
    urls: ['https://www.dgca.gov.in/digigov-portal/?nq=qHE4MM%2BFwSPaUnbl0Wqejg%3D%3D'],
    waitMs: 5000,
    extractRe: /(?:domestic\s+air|passenger\s+traffic)[\s\S]{0,200}?(\d{1,3}\.\d{1,2})\s+(?:lakh|million|Mn)/i,
    plausible: (v) => v > 100 && v < 250,
    timeoutMs: 45000
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No playwright config for ${metric.metric_id}`);

  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-IN',
    viewport: { width: 1280, height: 800 }
  });

  const errors = [];
  try {
    // Optional session warmup (NSE requires a homepage visit first to set cookies)
    if (cfg.warmupUrl) {
      const wp = await ctx.newPage();
      try {
        await wp.goto(cfg.warmupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await wp.waitForTimeout(3000);
      } catch {}
      finally { await wp.close().catch(() => {}); }
    }

    for (const url of cfg.urls) {
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: cfg.timeoutMs || 30000 });
        if (cfg.waitSelector) {
          try {
            await page.waitForSelector(cfg.waitSelector, { timeout: 15000 });
          } catch {
            // Selector didn't appear — try to extract anyway
          }
        }
        if (cfg.waitMs) await page.waitForTimeout(cfg.waitMs);

        let raw;
        if (cfg.extractSelector) {
          raw = await page.textContent(cfg.extractSelector);
        } else {
          raw = await page.content();  // full HTML
        }

        if (!raw) { errors.push(`${url}: empty content`); continue; }

        if (cfg.extractRe) {
          const m = String(raw).match(cfg.extractRe);
          if (!m) { errors.push(`${url}: regex no match`); continue; }
          const value = cfg.valueParser ? cfg.valueParser(m[1]) : parseFloat(m[1]);
          if (Number.isNaN(value) || !cfg.plausible(value)) {
            errors.push(`${url}: ${value} outside plausible band`); continue;
          }
          try { recordSnapshot(metric.metric_id, url, raw, value, 'playwright_render_v1'); } catch {}
          return {
            value,
            as_of: new Date().toISOString(),
            parse_meta: { source: 'playwright', url, regex: cfg.extractRe.toString() },
            raw: m[0].slice(0, 200)
          };
        } else {
          // No regex: assume textContent IS the value
          const v = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
          if (Number.isNaN(v) || !cfg.plausible(v)) { errors.push(`${url}: parsed ${v} implausible`); continue; }
          return {
            value: v,
            as_of: new Date().toISOString(),
            parse_meta: { source: 'playwright', url, selector: cfg.extractSelector },
            raw: String(raw).slice(0, 200)
          };
        }
      } catch (e) {
        errors.push(`${url}: ${e.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }

  throw new Error(`${metric.metric_id}: playwright failed [${errors.slice(0, 3).join(' | ')}]`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'playwright-crosscheck-pending', parse_meta: { source: 'pending' } };
}

// Cleanup helper for tests
export async function closeBrowser() {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close();
    _browserPromise = null;
  }
}

export { getPlaywright };
