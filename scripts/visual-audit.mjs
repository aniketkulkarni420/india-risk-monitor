#!/usr/bin/env node
// Visual audit · Phase 6 gate
//
// Spawns the local server, opens the product in headless Chromium at 5 viewports,
// captures screenshots, runs structural checks that require real rendering:
//   - horizontal scroll at any viewport (Gate 4)
//   - pill / chip overflow inside parent containers (Gate 4)
//   - first-paint H1 position vs viewport top (Gate 3, real measurement)
//   - drawer open/close cycle (Gate 1, runtime)
//   - lazy-render / sticky TOC engagement (Gate 4)
//
// Outputs:
//   audit-output/screenshots/{viewport}.png
//   audit-output/report.json
//   audit-output/report.md
//
// Requires: playwright (npm install playwright). Falls back gracefully with
// instructions if not installed.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'audit-output');
const SHOTS = join(OUT, 'screenshots');

mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile-360',  width: 360,  height: 800,  device: 'mobile' },
  { name: 'mobile-390',  width: 390,  height: 844,  device: 'mobile' },
  { name: 'mobile-430',  width: 430,  height: 932,  device: 'mobile' },
  { name: 'web-1366',    width: 1366, height: 768,  device: 'desktop' },
  { name: 'web-1440',    width: 1440, height: 900,  device: 'desktop' }
];

const PORT = 8123; // distinct from npm run serve's 8080
const URL = `http://localhost:${PORT}/app/index.html`;

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

// ──────────────────────────────────────────────────────────────
// Try import playwright — gracefully skip if not installed
// ──────────────────────────────────────────────────────────────
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log(RED('\n  Playwright not installed.\n'));
  console.log('  Install:    ' + BOLD('npm install playwright'));
  console.log('  Browsers:   ' + BOLD('npx playwright install chromium'));
  console.log('  Then:       ' + BOLD('npm run audit:visual'));
  console.log();
  console.log(DIM('  All other Phase 6 gates (build, data-contract, hierarchy, trust, release) pass via:'));
  console.log(DIM('             npm run audit'));
  console.log();
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────
// Spin up the dev server
// ──────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(__dirname, 'serve.mjs')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let resolved = false;
    proc.stdout.on('data', (chunk) => {
      if (!resolved && String(chunk).includes(`localhost:${PORT}`)) {
        resolved = true; resolve(proc);
      }
    });
    proc.on('error', reject);
    setTimeout(() => { if (!resolved) reject(new Error('server start timeout')); }, 5000);
  });
}

// ──────────────────────────────────────────────────────────────
// Per-viewport audit
// ──────────────────────────────────────────────────────────────
async function auditViewport(browser, vp) {
  const findings = [];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();

  // Capture console errors as audit findings
  page.on('pageerror', (err) => findings.push({ severity: 'fail', kind: 'js_error', msg: err.message }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') findings.push({ severity: 'warn', kind: 'console_error', msg: msg.text() });
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForSelector('.hero-vital, .hero-decks .display-tile', { timeout: 5000 });

  // ── Check 1: horizontal scroll at this viewport
  const hScroll = await page.evaluate(() => ({
    bodyW: document.body.scrollWidth,
    docW:  document.documentElement.scrollWidth,
    winW:  window.innerWidth
  }));
  if (hScroll.docW > hScroll.winW + 1) {
    findings.push({ severity: 'fail', kind: 'horizontal_scroll',
      msg: `document scrollWidth ${hScroll.docW} > viewport ${hScroll.winW}` });
  }

  // ── Check 2: pill overflow — every .pill must be within its parent's clientWidth
  const pillOverflow = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('.pill').forEach(pill => {
      const parent = pill.parentElement;
      if (!parent) return;
      const pr = pill.getBoundingClientRect();
      const par = parent.getBoundingClientRect();
      if (pr.right > par.right + 0.5 || pr.left < par.left - 0.5) {
        issues.push({ text: pill.textContent.trim(), parentTag: parent.tagName });
      }
    });
    return issues;
  });
  for (const issue of pillOverflow) {
    findings.push({ severity: 'fail', kind: 'pill_overflow',
      msg: `pill "${issue.text}" overflows parent <${issue.parentTag}>` });
  }

  // ── Check 3: H1 must be within first 250px of body content (Gate 3 real measurement)
  const h1Top = await page.evaluate(() => {
    const h1 = document.querySelector('.hero-h1');
    return h1 ? h1.getBoundingClientRect().top + window.scrollY : null;
  });
  if (h1Top != null && h1Top > 250) {
    findings.push({ severity: 'fail', kind: 'h1_below_fold',
      msg: `H1 lands at ${Math.round(h1Top)}px from body top (must be ≤ 250)` });
  }

  // ── Check 4: drawer open/close — runtime smoke test (desktop only; tap targets differ on mobile)
  if (vp.device === 'desktop') {
    try {
      await page.click('.hero-vital, .hero-decks .display-tile');
      await page.waitForSelector('.metric-drawer.open', { timeout: 2000 });
      const openOk = await page.locator('.metric-drawer.open').isVisible();
      if (!openOk) findings.push({ severity: 'fail', kind: 'drawer_open', msg: 'click on hero deck did not open drawer' });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.metric-drawer.open'), { timeout: 2000 });
    } catch (e) {
      findings.push({ severity: 'fail', kind: 'drawer_cycle', msg: e.message });
    }
  }

  // ── Check 5: sticky TOC engages on scroll past 720 (desktop only; hidden < 1280)
  if (vp.width >= 1280) {
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(400);
    const tocEngaged = await page.evaluate(() => {
      const t = document.querySelector('.sticky-toc');
      return t ? t.classList.contains('engaged') : false;
    });
    if (!tocEngaged) findings.push({ severity: 'warn', kind: 'toc_engagement',
      msg: 'sticky TOC did not gain .engaged class after scroll past 720' });
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // ── Screenshot full page
  const shotPath = join(SHOTS, `${vp.name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });

  await ctx.close();

  return { viewport: vp, findings, screenshot: shotPath };
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
console.log(BOLD('\nIRM visual audit · Phase 6 gate\n'));
console.log(DIM(`  ${VIEWPORTS.length} viewports · headless Chromium · output → audit-output/\n`));

const server = await startServer();
let browser;
const results = [];

try {
  browser = await chromium.launch({ headless: true });
  for (const vp of VIEWPORTS) {
    process.stdout.write(`  ${DIM('→')} ${vp.name.padEnd(14)}`);
    const result = await auditViewport(browser, vp);
    results.push(result);
    const fails = result.findings.filter(f => f.severity === 'fail').length;
    const warns = result.findings.filter(f => f.severity === 'warn').length;
    if (fails > 0)      console.log(`  ${RED('✗')} ${fails} fail · ${warns} warn`);
    else if (warns > 0) console.log(`  ${YELLOW('⚠')} 0 fail · ${warns} warn`);
    else                console.log(`  ${GREEN('✓')} clean`);
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

// ──────────────────────────────────────────────────────────────
// Write JSON + Markdown report
// ──────────────────────────────────────────────────────────────
const totalFails = results.reduce((a, r) => a + r.findings.filter(f => f.severity === 'fail').length, 0);
const totalWarns = results.reduce((a, r) => a + r.findings.filter(f => f.severity === 'warn').length, 0);

const json = {
  audit: 'visual',
  generated_at: new Date().toISOString(),
  viewports: VIEWPORTS.map(v => v.name),
  totals: { fails: totalFails, warns: totalWarns },
  results: results.map(r => ({
    viewport: r.viewport.name, width: r.viewport.width, height: r.viewport.height,
    findings: r.findings, screenshot: `screenshots/${r.viewport.name}.png`
  }))
};
writeFileSync(join(OUT, 'visual-report.json'), JSON.stringify(json, null, 2));

const md = [
  '# IRM Visual Audit · Phase 6',
  '',
  `Generated: ${json.generated_at}`,
  '',
  `**Total**: ${totalFails} failures · ${totalWarns} warnings across ${VIEWPORTS.length} viewports`,
  '',
  '## Per-viewport',
  '',
  ...results.map(r => {
    const fails = r.findings.filter(f => f.severity === 'fail');
    const warns = r.findings.filter(f => f.severity === 'warn');
    const status = fails.length ? '❌ FAIL' : warns.length ? '⚠ WARN' : '✅ PASS';
    return [
      `### ${r.viewport.name} (${r.viewport.width}×${r.viewport.height}) — ${status}`,
      '',
      `Screenshot: \`screenshots/${r.viewport.name}.png\``,
      '',
      ...(r.findings.length ? r.findings.map(f => `- **${f.severity.toUpperCase()}** [${f.kind}] ${f.msg}`) : ['No issues.']),
      ''
    ].join('\n');
  })
].join('\n');
writeFileSync(join(OUT, 'visual-report.md'), md);

console.log();
console.log(BOLD(`Result: ${totalFails === 0 ? GREEN('PASS') : RED('FAIL')} — ${totalFails} failures, ${totalWarns} warnings`));
console.log(DIM(`  → audit-output/visual-report.md`));
console.log(DIM(`  → audit-output/visual-report.json`));
console.log(DIM(`  → audit-output/screenshots/*.png\n`));

process.exit(totalFails ? 1 : 0);
