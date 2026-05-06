// Capture per-tab per-viewport screenshots so I can verify the new tier displays.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = 'http://localhost:8080/app/';
const VPS = [{ n: 'web-1440', w: 1440, h: 900 }, { n: 'mobile-360', w: 360, h: 800 }];
const TABS = ['flows', 'macro', 'economy', 'freight', 'market'];
mkdirSync('audit-output/sections', { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
for (const vp of VPS) {
  await p.setViewportSize({ width: vp.w, height: vp.h });
  for (const tab of TABS) {
    await p.goto(URL + '#' + tab, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    // expand any supporting tier on the active section
    await p.evaluate(() => {
      document.querySelectorAll('.section-frame[data-active="true"] .st-toggle').forEach(b => b.click());
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `audit-output/sections/${vp.n}-${tab}.png`, fullPage: true });
    console.log(`captured ${vp.n}-${tab}`);
  }
}
await b.close();
