#!/usr/bin/env node
// 1A+1B Hero merge smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4327;
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
await page.waitForSelector('.vital-row', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(500);

const r = await page.evaluate(() => ({
  vitalRow: document.querySelectorAll('.vital-row').length,
  tiles: document.querySelectorAll('.vital-tile').length,
  stressTiles: document.querySelectorAll('.vital-tile-value.is-stress').length,
  tilesWithStar: document.querySelectorAll('.vital-tile .star-btn').length,
  tilesWithPill: document.querySelectorAll('.vital-tile .pill').length,
  pillDirs: document.querySelectorAll('.vital-tile .pill-dir').length,
  heatmappedSubs: document.querySelectorAll('.vital-tile-sub[class*="heat-"]').length,
  inrTileVal: document.querySelector('.vital-tile[data-metric-id="inr_usd"] .vital-tile-value')?.textContent,
  brentTileVal: document.querySelector('.vital-tile[data-metric-id="brent_crude"] .vital-tile-value')?.textContent,
  fiiTileVal: document.querySelector('.vital-tile[data-metric-id="fii_equity_mtd"] .vital-tile-value')?.textContent
}));
// Star toggle test
const starTest = await page.evaluate(() => {
  const btn = document.querySelector('.vital-tile[data-metric-id="brent_crude"] .star-btn');
  btn.click();
  return { isOn: btn.classList.contains('on'), ls: localStorage.getItem('irm.followed') };
});
console.log(JSON.stringify(r, null, 2));
console.log('star toggle:', starTest);
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0 && r.vitalRow === 1 && r.tiles === 6 && r.tilesWithStar === 6 && r.tilesWithPill === 6 && starTest.isOn === true;
process.exit(ok ? 0 : 1);
