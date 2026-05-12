#!/usr/bin/env node
// 9D inline expand smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4323;
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
await page.waitForSelector('table tbody tr[data-metric-id]', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(600);

// Snapshot before
const before = await page.evaluate(() => document.querySelectorAll('tr.tr-inline-expand').length);
// Click first metric row (scroll into view first)
await page.evaluate(() => {
  const row = document.querySelector('tr[data-metric-id]');
  row.scrollIntoView({ block: 'center' });
  row.click();
});
await page.waitForTimeout(400);
const afterClick = await page.evaluate(() => {
  const exp = document.querySelectorAll('tr.tr-inline-expand');
  return {
    count: exp.length,
    sparkInside: exp[0] ? exp[0].querySelectorAll('svg').length : 0,
    hasDeepLink: exp[0] ? !!exp[0].querySelector('.inline-expand-deep') : false,
    hasParentExpanded: !!document.querySelector('tr.tr-expanded')
  };
});
// Click again — should toggle off
await page.evaluate(() => { document.querySelector('tr[data-metric-id]').click(); });
await page.waitForTimeout(200);
const afterToggle = await page.evaluate(() => document.querySelectorAll('tr.tr-inline-expand').length);

// Click two different rows in same tbody — only one expanded at a time
const afterTwo = await page.evaluate(() => {
  const rows = document.querySelectorAll('tbody tr[data-metric-id]');
  if (rows.length < 2) return null;
  // Find two rows in the same tbody
  let r1 = rows[0]; let r2 = null;
  for (let i = 1; i < rows.length; i++) { if (rows[i].parentNode === r1.parentNode) { r2 = rows[i]; break; } }
  if (!r2) return -1;
  r1.click();
  r2.click();
  return r1.parentNode.querySelectorAll('tr.tr-inline-expand').length;
});

console.log('before click:', before, '(expect 0)');
console.log('after click 1:', afterClick);
console.log('after toggle:', afterToggle, '(expect 0)');
console.log('after click 2 rows:', afterTwo, '(expect 1)');
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0 && afterClick.count === 1 && afterClick.sparkInside >= 1 && afterClick.hasDeepLink && afterToggle === 0 && afterTwo === 1;
process.exit(ok ? 0 : 1);
