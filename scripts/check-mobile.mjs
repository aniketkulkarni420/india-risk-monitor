// Check /m/ mobile route renders cleanly at 360/390/430
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8125;
const SHOTS = join(__dirname, '..', 'audit-output', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [join(__dirname, 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(r => server.stdout.on('data', d => String(d).includes(`localhost:${PORT}`) && r()));

const browser = await chromium.launch({ headless: true });
const VIEWPORTS = [{ name: 'm-360', w: 360, h: 800 }, { name: 'm-390', w: 390, h: 844 }, { name: 'm-430', w: 430, h: 932 }];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/app/m/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.m-section', { timeout: 5000 });

  const stats = await page.evaluate(() => ({
    h1: document.querySelector('.m-h1')?.textContent,
    primaryRendered: !!document.querySelector('.m-primary .display-tile'),
    sections: document.querySelectorAll('.m-section').length,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth
  }));

  // Open first section pill
  await page.click('.m-section:nth-of-type(1) > summary');
  await page.waitForTimeout(200);
  const expanded = await page.evaluate(() => document.querySelector('.m-section[open]') != null);

  // Take screenshot
  await page.screenshot({ path: join(SHOTS, `mobile-route-${vp.name}.png`), fullPage: true });

  console.log(`${vp.name} (${vp.w}×${vp.h}):`);
  console.log(`  H1: "${stats.h1}"`);
  console.log(`  Primary tile: ${stats.primaryRendered}`);
  console.log(`  Section pills: ${stats.sections} / 6`);
  console.log(`  H-scroll: ${stats.docW > stats.winW ? 'OVERFLOW ' + stats.docW : 'OK'}`);
  console.log(`  Expand on tap: ${expanded ? 'OK' : 'FAIL'}`);
  console.log(`  Errors: ${errs.length}`);
  for (const e of errs) console.log('   - ', e);
  await ctx.close();
}

await browser.close();
server.kill();
