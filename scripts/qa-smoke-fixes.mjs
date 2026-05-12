#!/usr/bin/env node
// Combined smoke test for the 5 fixes + Flows audit deltas
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4329;
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
await page.waitForSelector('.lens-row', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  // Drawer bug test · cluster card click should fire openDrawer with the metric_id (not [object Object])
  // We can't easily call internal openDrawer but we can verify the onclick is wired correctly
  // by checking that clicking a cluster card sets the hash to a valid metric id
  return {
    // Hormuz: MoM/YoY should be suppressed (history accruing)
    hormuzMom: document.querySelector('.hormuz-primary .hp-trends')?.textContent || '',
    // Timeline labels are absolutely positioned with opacity 0 by default
    timelineLabelsHidden: (() => {
      const labels = document.querySelectorAll('.timeline-strip-ev:not(.is-now) .timeline-strip-label');
      if (!labels.length) return null;
      const cs = getComputedStyle(labels[0]);
      return cs.opacity;
    })(),
    // Flows: magnitude bands now rendered as 3 colored ticks, not single text line
    flowBandTicks: document.querySelectorAll('.flow-band-tick').length,
    // Flows: bar trio tracks have gradient background (shaded zones)
    barTrackHasGradient: (() => {
      const t = document.querySelector('.bar-trio .bar-track');
      return t ? getComputedStyle(t).backgroundImage.includes('gradient') : false;
    })(),
    // Cumulative chart collapsed by default
    cumulativeCollapsed: !document.querySelector('.flows-cumulative-collapse[open]'),
    cumulativeExists: document.querySelectorAll('.flows-cumulative-collapse').length,
    // Supporting tier · no .spark-cell present
    supportingSparkCells: (() => {
      const tiers = document.querySelectorAll('.supporting-tier');
      let cells = 0;
      tiers.forEach(t => { cells += t.querySelectorAll('.spark-cell').length; });
      return cells;
    })(),
    // Cluster card click — fires hash with metric_id
    clusterCardCount: document.querySelectorAll('.cluster-card-cell').length,
  };
});
// Click a cluster card and verify hash is a real metric id (not [object Object])
const hashAfterClick = await page.evaluate(() => {
  const c = document.querySelector('.cluster-card-cell');
  if (!c) return null;
  c.click();
  return location.hash;
});
// Timeline · hovering a non-NOW event reveals its label
const hoveredOpacity = await page.evaluate(() => {
  const ev = document.querySelector('.timeline-strip-ev:not(.is-now)');
  if (!ev) return null;
  // Synthetically set hover state via pseudo trick: just inspect that opacity transitions are wired
  const lbl = ev.querySelector('.timeline-strip-label');
  return { transition: getComputedStyle(lbl).transition, initialOpacity: getComputedStyle(lbl).opacity };
});

console.log(JSON.stringify(r, null, 2));
console.log('hash after cluster click:', hashAfterClick);
console.log('hovered/transition:', hoveredOpacity);
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0
  && r.hormuzMom.includes('history accruing')
  && r.timelineLabelsHidden === '0'
  && r.flowBandTicks >= 3
  && r.barTrackHasGradient === true
  && r.cumulativeCollapsed === true
  && r.cumulativeExists === 1
  && r.supportingSparkCells === 0
  && hashAfterClick && !hashAfterClick.includes('[object');
process.exit(ok ? 0 : 1);
