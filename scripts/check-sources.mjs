// Smoke test the /sources/ route
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8126;
const SHOTS = join(__dirname, '..', 'audit-output', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [join(__dirname, 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(r => server.stdout.on('data', d => String(d).includes(`localhost:${PORT}`) && r()));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('page: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/app/sources/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.sources-table tbody tr', { timeout: 5000 });

const stats = await page.evaluate(() => ({
  trustCards: document.querySelectorAll('.trust-card').length,
  rows: document.querySelectorAll('#sources-body tr').length,
  sources: document.querySelectorAll('.source-card').length,
  hScroll: document.documentElement.scrollWidth > window.innerWidth,
  verifiedValue: document.querySelectorAll('.tc-value')[0]?.textContent
}));

// Test filter
await page.click('[data-filter="verified"]');
await page.waitForTimeout(200);
const verifiedRows = await page.locator('#sources-body tr').count();

// Test search
await page.click('[data-filter="all"]');
await page.fill('#filter-search', 'hormuz');
await page.waitForTimeout(200);
const searchRows = await page.locator('#sources-body tr').count();

// Screenshot
await page.fill('#filter-search', '');
await page.waitForTimeout(200);
await page.screenshot({ path: join(SHOTS, 'sources-1440.png'), fullPage: true });

console.log('Sources route smoke test:');
console.log('  trust cards:    ', stats.trustCards, '(expect 4)');
console.log('  table rows:     ', stats.rows);
console.log('  source cards:   ', stats.sources);
console.log('  horizontal scroll:', stats.hScroll);
console.log('  verified count: ', stats.verifiedValue);
console.log('  filter "verified" rows:', verifiedRows);
console.log('  search "hormuz" rows:  ', searchRows);
console.log('  errors:', errs.length);
for (const e of errs) console.log('   -', e);

await browser.close();
server.kill();
process.exit(errs.length ? 1 : 0);
