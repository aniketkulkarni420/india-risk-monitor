// Shared Playwright browser singleton.
// Replaces per-parser browser instances. Saves ~2-3s per parser invocation
// (chromium cold start cost). Single shared browser is closed on process
// signal handlers.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let _browserPromise = null;
let _closed = false;

const LAUNCH_ARGS = [
  '--disable-http2',                          // bypass NSE's HTTP/2 bot wall
  '--disable-blink-features=AutomationControlled',  // hide webdriver fingerprint
  '--single-process',                         // Windows perf · ~200ms faster launch
  '--disable-dev-shm-usage',                  // Avoid shm crashes in CI
  '--no-sandbox',                             // CI containers
  '--disable-gpu'                             // headless doesn't need GPU
];

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Get the shared chromium browser. Lazy-launches on first call. Returns
 * null if playwright isn't installed (fallback path).
 */
export async function getSharedBrowser() {
  if (_closed) {
    _browserPromise = null;
    _closed = false;
  }
  if (!_browserPromise) {
    let pw;
    try { pw = require('playwright'); }
    catch { return null; }
    _browserPromise = pw.chromium.launch({ headless: true, args: LAUNCH_ARGS });
    // Best-effort cleanup on process exit
    const close = async () => {
      try { _closed = true; const b = await _browserPromise; await b.close(); } catch {}
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    process.once('beforeExit', close);
  }
  return _browserPromise;
}

/**
 * Convenience: create a fresh browser context with sensible defaults.
 * Caller is responsible for ctx.close() after use.
 */
export async function newContext({ userAgent = DEFAULT_UA, locale = 'en-IN', viewport = { width: 1280, height: 800 } } = {}) {
  const b = await getSharedBrowser();
  if (!b) throw new Error('playwright not installed');
  return b.newContext({ userAgent, locale, viewport });
}

/**
 * Explicit close for tests / cleanup. Idempotent.
 */
export async function closeBrowser() {
  if (_browserPromise) {
    try { _closed = true; const b = await _browserPromise; await b.close(); } catch {}
    _browserPromise = null;
  }
}

export { DEFAULT_UA };
