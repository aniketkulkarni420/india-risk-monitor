// Comprehensive screenshot capture for Claude Design handoff.
//
// Captures the live site (india-risk-monitor.pages.dev) across:
//   - 4 viewports: desktop 1440 + desktop 1920, mobile 390 + mobile 360
//   - 2 themes: actual dark + synthesized light (CSS override)
//   - 7 sections: hero + flows + macro + economy + freight + market + sectors
//   - All drawers/expansions auto-opened per section
//
// Output: <OUT>/<viewport>/<theme>/<section>.png  + index.html  + zip
//
// Light theme is SYNTHESIZED via CSS variable override (site doesn't
// natively support light yet) — clearly labeled in the index.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || 'https://india-risk-monitor.pages.dev/';
const OUT  = resolve(__dirname, '..', 'screenshots-claude-design');

const VIEWPORTS = [
  { name: 'desktop-1440', w: 1440, h: 900,  scale: 1, mobile: false },
  { name: 'desktop-1920', w: 1920, h: 1080, scale: 1, mobile: false },
  { name: 'mobile-390',   w: 390,  h: 844,  scale: 2, mobile: true  },
  { name: 'mobile-360',   w: 360,  h: 800,  scale: 2, mobile: true  }
];

const SECTIONS = [
  { id: 'hero',     label: 'Hero / score' },
  { id: 'flows',    label: 'Institutional flows' },
  { id: 'macro',    label: 'Macro' },
  { id: 'economy',  label: 'Real economy' },
  { id: 'freight',  label: 'Freight' },
  { id: 'market',   label: 'Market' },
  { id: 'sectors',  label: 'Sectors' }
];

// CSS override that approximates light theme by swapping the root variables.
// Site doesn't natively support light — this gives a directional preview only.
const LIGHT_OVERRIDE_CSS = `
:root {
  --bg: #fafbfc !important;
  --bg-soft: #f3f4f6 !important;
  --surface: #ffffff !important;
  --surface-2: #f9fafb !important;
  --card: #ffffff !important;
  --line: #e5e7eb !important;
  --line-soft: #f0f1f4 !important;
  --ink: #0a0e14 !important;
  --text: #0a0e14 !important;
  --text-soft: #2b3340 !important;
  --mute: #5c6471 !important;
  --dim: #8b95a3 !important;
  --accent: #b45309 !important;
  color-scheme: light !important;
}
body, html { background: #fafbfc !important; color: #0a0e14 !important; }
.card, .metric-card, [class*="card"] { background: #ffffff !important; }
.pill-high { background: #fff7ed !important; color: #c2410c !important; }
.pill-med { background: #fefce8 !important; color: #b45309 !important; }
.pill-shock { background: #fef2f2 !important; color: #b91c1c !important; }
.pill-low { background: #f0fdf4 !important; color: #15803d !important; }
.heat-pos-strong, .heat-pos-mid { background: #f0fdf4 !important; color: #166534 !important; }
.heat-neg-strong, .heat-neg-mid { background: #fef2f2 !important; color: #991b1b !important; }
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function expandEverything(page) {
  // Open every interactive disclosure we can find.
  // This is a best-effort sweep; missing nothing is more important than precision.
  await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // 1. Section tabs — make sure each section is rendered (mobile)
    const tabs = document.querySelectorAll('[role="tab"], .section-tab, .nav-tab, [data-section]');
    for (const t of tabs) {
      try { t.click(); await wait(120); } catch {}
    }

    // 2. Click EVERY metric row to open inline 9D expansions
    const rows = document.querySelectorAll('.metric-row, [class*="metric-row"], .row-clickable, [data-metric-id]');
    for (const r of rows) {
      try {
        if (!r.dataset.expanded) {
          r.click();
          r.dataset.expanded = '1';
          await wait(60);
        }
      } catch {}
    }

    // 3. Star buttons — light them up so the "followed" state is visible
    const stars = document.querySelectorAll('.star, .star-btn, [class*="star"]');
    const max = Math.min(stars.length, 8);
    for (let i = 0; i < max; i++) {
      try { stars[i].click(); await wait(40); } catch {}
    }

    // 4. Any element with aria-expanded=false or data-collapsed=true → toggle
    const collapsibles = document.querySelectorAll(
      '[aria-expanded="false"], [data-collapsed="true"], .collapsed, details:not([open])'
    );
    for (const c of collapsibles) {
      try {
        if (c.tagName === 'DETAILS') c.open = true;
        else c.click();
        await wait(60);
      } catch {}
    }

    // 5. Force-render anything lazy by scrolling to bottom + back
    window.scrollTo(0, document.body.scrollHeight);
    await wait(200);
    window.scrollTo(0, 0);
    await wait(200);
  });
  await sleep(900);
}

async function scrollToSection(page, sectionId) {
  // Try multiple strategies — site structure varies.
  await page.evaluate((id) => {
    const sel = [
      `#${id}`,
      `[data-section="${id}"]`,
      `section[data-section-id="${id}"]`,
      `.section-${id}`,
      `.section[data-id="${id}"]`
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el) { el.scrollIntoView({ behavior: 'instant', block: 'start' }); return; }
    }
    // Fallback: scroll proportionally
    const ids = ['hero','flows','macro','economy','freight','market','sectors'];
    const idx = ids.indexOf(id);
    if (idx >= 0) {
      const frac = idx / (ids.length - 1);
      window.scrollTo(0, document.body.scrollHeight * frac);
    }
  }, sectionId);
  await sleep(500);
}

async function captureSection(page, sectionId, outPath) {
  await scrollToSection(page, sectionId);
  // Try to clip to the section element if findable; else viewport-size shot
  const clip = await page.evaluate((id) => {
    const sel = [`#${id}`, `[data-section="${id}"]`, `.section-${id}`];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el) {
        const r = el.getBoundingClientRect();
        // Convert to absolute coords (account for scroll)
        const x = r.left + window.scrollX;
        const y = r.top + window.scrollY;
        return { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(r.width, document.documentElement.clientWidth), height: Math.min(r.height, 4000) };
      }
    }
    return null;
  }, sectionId);

  if (clip && clip.width > 50 && clip.height > 50) {
    await page.screenshot({ path: outPath, clip, animations: 'disabled' });
  } else {
    // Section not addressable — take viewport-window screenshot at current scroll
    await page.screenshot({ path: outPath, fullPage: false, animations: 'disabled' });
  }
}

async function captureFullPage(page, outPath) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.screenshot({ path: outPath, fullPage: true, animations: 'disabled' });
}

// ───────────────────── MAIN ─────────────────────
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });

const manifest = { url: URL, generated_at: new Date().toISOString(), captures: [] };

for (const vp of VIEWPORTS) {
  for (const theme of ['dark', 'light']) {
    const dir = join(OUT, vp.name, theme);
    mkdirSync(dir, { recursive: true });
    console.log(`\n[${vp.name}/${theme}] starting`);

    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: vp.scale,
      isMobile: vp.mobile,
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.warn(`  pageerror: ${e.message.slice(0,80)}`));

    try {
      await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (e) {
      console.warn(`  goto warn: ${e.message.slice(0,80)} — continuing`);
    }

    // Wait for data to load
    await page.waitForLoadState('domcontentloaded');
    await sleep(2500);

    if (theme === 'light') {
      await page.addStyleTag({ content: LIGHT_OVERRIDE_CSS });
      await sleep(500);
    }

    // First-pass expand
    await expandEverything(page);

    // Capture each section
    for (const sec of SECTIONS) {
      const out = join(dir, `${sec.id}.png`);
      try {
        await captureSection(page, sec.id, out);
        manifest.captures.push({ viewport: vp.name, theme, section: sec.id, file: relative(OUT, out).replace(/\\/g,'/') });
        console.log(`  ✓ ${sec.id}`);
      } catch (e) {
        console.warn(`  ✗ ${sec.id}: ${e.message.slice(0,80)}`);
      }
    }

    // One full-page screenshot per (viewport × theme) — everything expanded
    try {
      const full = join(dir, '_full-page.png');
      await captureFullPage(page, full);
      manifest.captures.push({ viewport: vp.name, theme, section: '_full-page', file: relative(OUT, full).replace(/\\/g,'/') });
      console.log(`  ✓ _full-page`);
    } catch (e) {
      console.warn(`  ✗ full-page: ${e.message.slice(0,80)}`);
    }

    await ctx.close();
  }
}

await browser.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ───────── Generate index.html ─────────
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IRM screenshots · Claude Design handoff</title>
<style>
body { background: #0f1419; color: #e4e7eb; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.02em; }
.sub { color: #8b95a3; margin: 0 0 24px; font-size: 13px; }
.warn { background: rgba(245,158,11,0.1); border-left: 3px solid #f59e0b; padding: 12px 16px; margin: 0 0 24px; font-size: 13px; border-radius: 4px; }
.warn b { color: #f59e0b; }
.vp { margin-bottom: 48px; }
.vp h2 { font-size: 16px; margin: 0 0 4px; }
.vp .vp-meta { color: #8b95a3; font-size: 12px; margin-bottom: 16px; font-family: ui-monospace, monospace; }
.theme-row { display: flex; gap: 24px; margin-bottom: 20px; }
.theme-col { flex: 1; }
.theme-col h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #8b95a3; margin: 0 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.thumb { background: #131820; border: 1px solid #1f2733; border-radius: 6px; overflow: hidden; display: block; text-decoration: none; }
.thumb img { width: 100%; height: 140px; object-fit: cover; object-position: top; display: block; }
.thumb .label { padding: 8px 10px; font-size: 11px; color: #c4c7cc; font-family: ui-monospace, monospace; }
.full-link { display: inline-block; margin-bottom: 8px; padding: 6px 10px; background: rgba(96,165,250,0.1); color: #60a5fa; border-radius: 4px; font-size: 11px; text-decoration: none; }
.full-link:hover { background: rgba(96,165,250,0.2); }
</style></head>
<body>
<h1>IRM · screenshots for Claude Design</h1>
<p class="sub">Captured from ${URL} on ${new Date().toISOString()} · 4 viewports × 2 themes × 7 sections + full-page · all drawers and expansions auto-opened before capture.</p>

<div class="warn">
<b>Light theme is synthesized.</b> The live site doesn't natively support light mode — light captures are produced by injecting a CSS-variable override at runtime. Treat as directional preview only; the real light-theme design hasn't been built yet.
</div>

${VIEWPORTS.map(vp => `
<section class="vp">
  <h2>${vp.name}</h2>
  <div class="vp-meta">${vp.w} × ${vp.h} · ${vp.mobile ? 'mobile UA' : 'desktop UA'} · ${vp.scale}x</div>
  <div class="theme-row">
    ${['dark','light'].map(theme => `
    <div class="theme-col">
      <h3>${theme}</h3>
      <a href="${vp.name}/${theme}/_full-page.png" class="full-link" target="_blank">↗ Open full-page (everything expanded)</a>
      <div class="grid">
        ${SECTIONS.map(sec => `
          <a class="thumb" href="${vp.name}/${theme}/${sec.id}.png" target="_blank">
            <img src="${vp.name}/${theme}/${sec.id}.png" loading="lazy" alt="${sec.id}">
            <div class="label">${sec.id} · ${sec.label}</div>
          </a>
        `).join('')}
      </div>
    </div>
    `).join('')}
  </div>
</section>
`).join('')}

</body></html>`;
writeFileSync(join(OUT, 'index.html'), html);

console.log(`\n✓ Done. Output: ${OUT}`);
console.log(`  manifest.json + index.html + ${manifest.captures.length} screenshots`);
