#!/usr/bin/env node
// Supporting metrics composite smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4324;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.json':'application/json' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  try { statSync(resolve(root, '.' + p)); res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); createReadStream(resolve(root, '.' + p)).pipe(res); }
  catch { res.statusCode = 404; res.end('404'); }
});
server.listen(port);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.supporting-tier', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  return {
    tiers: document.querySelectorAll('.supporting-tier').length,
    promoted: document.querySelectorAll('.st-promoted').length,
    promotedHigh: document.querySelectorAll('.st-promoted-high').length,
    promotedShock: document.querySelectorAll('.st-promoted-shock').length,
    changehints: document.querySelectorAll('.st-changehint').length,
    summaryLabels: document.querySelectorAll('.st-summary').length,
    reviewDots: document.querySelectorAll('.st-review-dot').length,
  };
});
console.log(JSON.stringify(r, null, 2));
console.log('errors:', errors);
await browser.close(); server.close();
process.exit(errors.length || r.tiers === 0 ? 1 : 0);
