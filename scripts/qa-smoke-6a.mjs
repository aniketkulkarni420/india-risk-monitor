#!/usr/bin/env node
// 6A star button smoke test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'app');
const port = 4325;
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
await page.waitForSelector('.star-btn', { state: 'attached', timeout: 30000 });
await page.waitForTimeout(600);

const r1 = await page.evaluate(() => ({
  stars: document.querySelectorAll('.star-btn').length,
  starsOn: document.querySelectorAll('.star-btn.on').length,
  ls: localStorage.getItem('irm.followed') || '[]'
}));
// Toggle first star
const eventLog = await page.evaluate(() => {
  return new Promise(res => {
    let payload = null;
    window.addEventListener('irm:followed:change', (e) => { payload = e.detail; });
    const btn = document.querySelector('.star-btn');
    btn.click();
    setTimeout(() => res({ payload, isOn: btn.classList.contains('on'), ls: localStorage.getItem('irm.followed') }), 80);
  });
});
// Toggle off
const off = await page.evaluate(() => {
  const btn = document.querySelector('.star-btn');
  btn.click();
  return { isOn: btn.classList.contains('on'), ls: localStorage.getItem('irm.followed') };
});
// Click doesn't open inline expand (stopPropagation)
const expandsAfterStar = await page.evaluate(() => {
  document.querySelector('.star-btn').click();
  return document.querySelectorAll('tr.tr-inline-expand').length;
});
console.log('initial stars / on / ls:', r1);
console.log('after toggle on:', eventLog);
console.log('after toggle off:', off);
console.log('expands after star click (should be 0):', expandsAfterStar);
console.log('errors:', errors);
await browser.close(); server.close();
const ok = errors.length === 0 && r1.stars > 0 && eventLog.isOn === true && eventLog.payload && eventLog.payload.count === 1 && off.isOn === false && expandsAfterStar === 0;
process.exit(ok ? 0 : 1);
