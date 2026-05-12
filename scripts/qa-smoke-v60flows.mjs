#!/usr/bin/env node
// V60 Flows smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4326;
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

await page.goto(`http://localhost:${port}/#flows`, { waitUntil: 'networkidle' });
await page.waitForSelector('.lens-row', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => ({
  lensRow: document.querySelectorAll('.lens-row').length,
  lensCells: document.querySelectorAll('.lens-cell').length,
  catStrip: document.querySelectorAll('.cat-strip').length,
  catTabs: document.querySelectorAll('.cat-tab').length,
  activeTab: document.querySelector('.cat-tab.active')?.getAttribute('data-tab-id'),
  focused: document.querySelectorAll('.flows-focused').length,
  flowCells: document.querySelectorAll('.flow-cell').length,
  barTrio: document.querySelectorAll('.bar-trio').length,
  barRows: document.querySelectorAll('.bar-row').length,
  narrative: !!document.querySelector('.flow-narrative'),
  absorbGauge: document.querySelectorAll('.absorb-gauge').length,
  persistenceBar: document.querySelectorAll('.persistence-bar').length,
  // sectoral bars removed check
  divergingBars: document.querySelectorAll('[data-viz="diverging-bars"]').length
}));
// Click "today" tab and re-check active
const afterClick = await page.evaluate(() => {
  const todayTab = Array.from(document.querySelectorAll('.cat-tab')).find(t => t.getAttribute('data-tab-id') === 'today');
  todayTab.click();
  return {
    activeTab: document.querySelector('.cat-tab.active')?.getAttribute('data-tab-id'),
    flowCellsAfter: document.querySelectorAll('.flow-cell').length,
    netInFirstCell: document.querySelector('.flow-cell .flow-cell-value')?.textContent
  };
});
console.log(JSON.stringify(r, null, 2));
console.log('after tab click:', afterClick);
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0
  && r.lensRow === 1 && r.lensCells === 4
  && r.catTabs === 4 && r.activeTab === 'mtd'
  && r.focused === 1 && r.flowCells === 3
  && r.barTrio === 1 && r.barRows >= 3
  && r.narrative === true
  && afterClick.activeTab === 'today';
process.exit(ok ? 0 : 1);
