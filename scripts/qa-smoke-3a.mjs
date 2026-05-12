#!/usr/bin/env node
// Quick smoke test for the 3A range tick wiring.
// Spins up a tiny static server, points headless Chromium at local dist,
// and asserts .range-tick + .range-tick-bar count + grabs the label text.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'app');
const port = 4321;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const full = resolve(root, '.' + p);
  try {
    statSync(full);
    res.setHeader('Content-Type', MIME[extname(full)] || 'application/octet-stream');
    createReadStream(full).pipe(res);
  } catch {
    res.statusCode = 404; res.end('404');
  }
});
server.listen(port);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror',  e => errors.push(e.message));
page.on('console',    m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('table tbody tr', { timeout: 30000 }).catch(() => {});
// click into macro tab to ensure macro section visible
await page.evaluate(() => { window.location.hash = '#macro'; });
await page.waitForTimeout(1500);

const counts = await page.evaluate(() => {
  const a = document.querySelectorAll('.range-tick').length;
  const b = document.querySelectorAll('.range-tick-bar').length;
  const labels = Array.from(document.querySelectorAll('.range-tick-label')).slice(0,6).map(n => n.textContent.trim());
  return { rangeTick: a, rangeTickBar: b, labels };
});

console.log('range-tick count:', counts.rangeTick);
console.log('range-tick-bar count:', counts.rangeTickBar);
console.log('first labels:', counts.labels);
console.log('console errors:', errors);

await browser.close();
server.close();
process.exit(errors.length || counts.rangeTick === 0 ? 1 : 0);
