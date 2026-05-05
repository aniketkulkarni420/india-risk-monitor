// Smoke-test the drawer's period selector with backfilled history
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8127;

const server = spawn(process.execPath, [join(__dirname, 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(r => server.stdout.on('data', d => String(d).includes(`localhost:${PORT}`) && r()));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto(`http://localhost:${PORT}/app/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hero-vital');

// Open drawer for Brent
await page.evaluate(() => location.hash = 'metric=brent_crude');
await page.waitForSelector('.metric-drawer.open', { timeout: 3000 });
await page.waitForTimeout(800);

const stats1Y = await page.evaluate(() => {
  const chart = document.querySelector('.md-chart svg');
  const range = document.querySelector('.md-chart > div:last-child');
  return { chartExists: !!chart, rangeText: range?.textContent };
});

// Click 5Y
await page.click('.md-period[data-period="5Y"]');
await page.waitForTimeout(400);
const stats5Y = await page.evaluate(() => {
  const range = document.querySelector('.md-chart > div:last-child');
  return { rangeText: range?.textContent };
});

// Click 1M
await page.click('.md-period[data-period="1M"]');
await page.waitForTimeout(400);
const stats1M = await page.evaluate(() => {
  const range = document.querySelector('.md-chart > div:last-child');
  return { rangeText: range?.textContent };
});

console.log('Drawer period selector smoke test (Brent crude):');
console.log('  1Y view:', stats1Y);
console.log('  5Y view:', stats5Y);
console.log('  1M view:', stats1M);
console.log('  errors:', errs.length);
for (const e of errs) console.log('   -', e);

await browser.close();
server.kill();
process.exit(errs.length ? 1 : 0);
