#!/usr/bin/env node
// Verify PROVISIONAL marker propagates to Hero narrative + today bullets + condensed lead
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4331;
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
await page.waitForSelector('.hero-vital', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const bodyText = document.body.innerText;
  const todayBullets = document.querySelector('#hero-today')?.innerHTML || '';
  return {
    pageHasProvisional: bodyText.includes('PROVISIONAL'),
    todayBulletsHasProvisional: todayBullets.includes('PROVISIONAL'),
    todayBulletsHasHormuz: todayBullets.toLowerCase().includes('hormuz'),
    condensedLeadText: document.querySelector('.hero-condensed-lead')?.textContent || ''
  };
});
console.log(JSON.stringify(r, null, 2));
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0 && r.pageHasProvisional && r.todayBulletsHasProvisional;
process.exit(ok ? 0 : 1);
