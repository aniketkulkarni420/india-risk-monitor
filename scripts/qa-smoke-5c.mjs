#!/usr/bin/env node
// 5C timeline strip smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'app');
const port = 4322;
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
await page.waitForSelector('table tbody tr', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  return {
    timelineStrips: document.querySelectorAll('.timeline-strip').length,
    timelineEvents: document.querySelectorAll('.timeline-strip-ev').length,
    nowMarkers: document.querySelectorAll('.timeline-strip-ev.is-now').length,
    shockDots: document.querySelectorAll('.timeline-strip-dot-shock').length,
    highDots: document.querySelectorAll('.timeline-strip-dot-high').length,
    sections: document.querySelectorAll('.section-frame').length,
  };
});
console.log('timeline strips:', r.timelineStrips);
console.log('timeline events:', r.timelineEvents);
console.log('now markers (should equal strips):', r.nowMarkers);
console.log('shock dots:', r.shockDots);
console.log('high dots:', r.highDots);
console.log('sections:', r.sections);
console.log('console errors:', errors);
await browser.close();
server.close();
process.exit(errors.length || r.timelineStrips < 6 ? 1 : 0);
