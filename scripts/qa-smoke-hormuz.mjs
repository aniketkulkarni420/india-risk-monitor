#!/usr/bin/env node
// Hormuz provisional UI smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4330;
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

await page.goto(`http://localhost:${port}/#freight`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hormuz-primary', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const hp = document.querySelector('.hormuz-primary');
  return {
    cardPresent: !!hp,
    provisionalPill: hp?.querySelector('.hp-provisional')?.textContent || null,
    trendsText: hp?.querySelector('.hp-trends')?.textContent || '',
    valueText: hp?.querySelector('.hp-value')?.textContent || '',
    hasMomDisplay: (hp?.querySelector('.hp-trends')?.textContent || '').includes('MoM '),
    hasInbound: (hp?.querySelector('.hp-trends')?.textContent || '').includes('inbound'),
    hasDarkVessels: (hp?.querySelector('.hp-trends')?.textContent || '').includes('dark vessels'),
    hasHistoryAccruing: (hp?.querySelector('.hp-trends')?.textContent || '').includes('history accruing')
  };
});
console.log(JSON.stringify(r, null, 2));
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0
  && r.cardPresent
  && r.provisionalPill && r.provisionalPill.includes('PROVISIONAL')
  && r.hasInbound
  && r.hasDarkVessels
  && r.hasHistoryAccruing
  && !r.hasMomDisplay;
process.exit(ok ? 0 : 1);
