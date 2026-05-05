// Smoke-test the standalone preview file
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const url = pathToFileURL('C:/Users/anike/Downloads/IRM_Preview.html').href;
await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(800);

const desktopOk = await page.locator('#desktop-view .hero-h1').isVisible();
const heroText = desktopOk ? await page.locator('#desktop-view .hero-h1').textContent() : null;

const heroDecks = await page.locator('#desktop-view .hero-decks .display-tile').count();
const sectionFrames = await page.locator('#desktop-view .section-frame').count();

await page.click('#btn-mobile');
await page.waitForTimeout(400);
const mobileVisible = await page.locator('#mobile-view').isVisible();
const mobileH1 = await page.locator('#mobile-view #m-h1').textContent().catch(() => null);
const mobileSections = await page.locator('#mobile-view .m-section').count();

console.log('Preview smoke test:');
console.log('  desktop view rendered:    ', desktopOk);
console.log('  hero h1:                  ', heroText);
console.log('  hero decks (expect 4):    ', heroDecks);
console.log('  section frames (expect 6):', sectionFrames);
console.log('  mobile toggle works:      ', mobileVisible);
console.log('  mobile h1:                ', mobileH1);
console.log('  mobile section pills:     ', mobileSections);
console.log('  errors:                   ', errors.length);
for (const e of errors) console.log('    -', e);

await browser.close();
process.exit(errors.length ? 1 : 0);
