// Capture screenshots of the live deployed site for design audit
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, '..', 'audit-output', 'live');
mkdirSync(SHOTS, { recursive: true });

const URL = 'https://india-risk-monitor.pages.dev/';
const browser = await chromium.launch({ headless: true });

for (const vp of [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(800);

  const stats = await page.evaluate(() => ({
    h1: document.querySelector('.hero-h1')?.textContent,
    vital: !!document.querySelector('.hero-vital'),
    sections: document.querySelectorAll('.section-frame').length,
    docHeight: document.body.scrollHeight,
    docWidth: document.documentElement.scrollWidth,
    winWidth: window.innerWidth
  }));

  await page.screenshot({ path: join(SHOTS, `${vp.name}.png`), fullPage: true });
  console.log(`${vp.name}: H1="${stats.h1}", vital=${stats.vital}, sections=${stats.sections}, height=${stats.docHeight}px, hScroll=${stats.docWidth>stats.winWidth}, errors=${errs.length}`);
  if (errs.length) for (const e of errs.slice(0,3)) console.log('  · ', e.slice(0,140));
  await ctx.close();
}
await browser.close();
