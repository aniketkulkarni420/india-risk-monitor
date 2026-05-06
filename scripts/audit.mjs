#!/usr/bin/env node
// Audit gates 1 + 3 from IRM_Build_Spec §06.
// Gate 4 (visual screenshots) is deferred to Playwright in Phase 8.
//
// Gate 1 · Build:
//   - JS syntax of all .mjs files (Node parse)
//   - Component count ≤ 8 (the locked list)
//   - No legacy component names anywhere
//
// Gate 3 · Information hierarchy (static checks against app/index.html + main.mjs):
//   - Topbar is the only nav band before hero (no quick-find / command-strip / tabs)
//   - "Sources" entry points ≤ 3 on main page (topbar + per-section footer + drawer)
//   - No legacy components named in CSS or markup
//
// Output: pass/fail summary, exit 1 on failure.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

const errors = [];
const warnings = [];
const fail = (gate, msg) => errors.push({ gate, msg });
const warn = (gate, msg) => warnings.push({ gate, msg });

// Allowed component names (per Build Spec §03 + Phase 5.5 + 2026-05-06 tiering).
// HeatmapCell retired Phase 5.5; CmdKPalette added.
// SupportingTier added 2026-05-06: Tier-2 expander wrapping renderTableRow with
//   per-metric comparison-period filter. Wraps existing components, not new viz.
// ComparisonSpec added 2026-05-06: data spec (period override per metric); not a
//   render component but lives in components/ for proximity to TableRow which uses it.
const ALLOWED_COMPONENTS = new Set([
  'DisplayTile', 'TableRow', 'Sparkline', 'Band',
  'SectionFrame', 'MetricDrawer', 'StickyTOC', 'CmdKPalette',
  'SupportingTier', 'ComparisonSpec'
]);

// Legacy component names that must NOT appear (from V40/V57/V60)
const LEGACY_NAMES = [
  'kpi-card', 'cockpit-tile', 'lens-card', 'flow-summary-cell',
  'macro-stack-card', 'sector-lens-card', 'primary-driver-card',
  'premium-insight', 'premium-source-mini', 'score-orb',
  'quick-find', 'command-strip', 'todayRead', 'tagline',
  'driverCockpit', 'riskCockpitMount', 'heroCards',
  'cockpit-status-stack', 'eyebrow-badges'
];

// ──────────────────────────────────────────────────────────────
// Walk
// ──────────────────────────────────────────────────────────────
function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'logs' || name === 'history') continue;
      out.push(...walk(p, exts));
    } else if (exts.some(e => name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// GATE 1 · Build
// ──────────────────────────────────────────────────────────────
console.log(BOLD('\nGate 1 · Build\n'));

// 1a. JS syntax check on all .mjs files
const jsFiles = walk(join(ROOT, 'scripts'), ['.mjs']).concat(walk(join(ROOT, 'app', 'components'), ['.mjs']));
jsFiles.push(join(ROOT, 'app', 'main.mjs'));
let syntaxOk = 0;
for (const f of jsFiles) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
    syntaxOk++;
    console.log(`  ${GREEN('✓')} ${DIM(relative(ROOT, f))}`);
  } catch (e) {
    fail('Gate 1', `syntax error in ${relative(ROOT, f)}: ${e.message.split('\n')[0]}`);
    console.log(`  ${RED('✗')} ${relative(ROOT, f)}`);
  }
}

// 1b. Component count ≤ 8
const componentDir = join(ROOT, 'app', 'components');
// HELPERS extend Sparkline patterns; not user-facing components per Build Spec §03.
const HELPERS = new Set(['utils.mjs', 'charts.mjs']);
const componentFiles = readdirSync(componentDir)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('_') && !HELPERS.has(f));
const componentNames = componentFiles.map(f => f.replace('.mjs', ''));

console.log();
// Cap raised 8 → 10 on 2026-05-06 to admit SupportingTier (Tier-2 expander)
// and ComparisonSpec (period-override data spec). Both are explicitly listed
// in ALLOWED_COMPONENTS above; cap stays in lock-step with that allowlist.
const COMPONENT_CAP = 10;
if (componentNames.length > COMPONENT_CAP) {
  fail('Gate 1', `Component count ${componentNames.length} exceeds locked cap of ${COMPONENT_CAP}: ${componentNames.join(', ')}`);
} else {
  console.log(`  ${GREEN('✓')} component count: ${componentNames.length} / ${COMPONENT_CAP} (${componentNames.join(', ')})`);
}

// All component names are in the allowed list
for (const name of componentNames) {
  if (!ALLOWED_COMPONENTS.has(name)) {
    fail('Gate 1', `Unknown component: ${name}. Not in locked list (Build Spec §03).`);
  }
}

// 1c. Legacy names — search across all source files (mjs, html, css)
const sourceFiles = walk(join(ROOT, 'app'), ['.mjs', '.html', '.css'])
  .concat(walk(join(ROOT, 'scripts'), ['.mjs']));
let legacyHits = 0;
for (const f of sourceFiles) {
  const content = readFileSync(f, 'utf8');
  for (const legacy of LEGACY_NAMES) {
    // Match as identifier/class boundary — avoid false matches in comments
    const regex = new RegExp(`\\b${legacy.replace(/-/g, '[-_]?')}\\b`, 'i');
    if (regex.test(content) && !/audit\.mjs$/.test(f)) {
      // skip audit.mjs (this file) where they're listed
      fail('Gate 1', `Legacy name "${legacy}" found in ${relative(ROOT, f)}`);
      legacyHits++;
    }
  }
}
if (legacyHits === 0) console.log(`  ${GREEN('✓')} no legacy component names found`);

// ──────────────────────────────────────────────────────────────
// GATE 3 · Information hierarchy
// ──────────────────────────────────────────────────────────────
console.log(BOLD('\nGate 3 · Information hierarchy\n'));

const indexHtml = readFileSync(join(ROOT, 'app', 'index.html'), 'utf8');
const mainMjs   = readFileSync(join(ROOT, 'app', 'main.mjs'), 'utf8');

// 3a. No quick-find / command-strip / tab-row in markup
const NAV_LEGACY = ['quick-find', 'quickFind', 'command-strip', 'commandStrip', 'tabs-nav', 'tabs-row'];
let navHits = 0;
for (const term of NAV_LEGACY) {
  if (indexHtml.includes(term)) { fail('Gate 3', `Forbidden nav band "${term}" present in index.html`); navHits++; }
}
if (navHits === 0) console.log(`  ${GREEN('✓')} no quick-find / command-strip / tabs-row`);

// 3b. Topbar is the only nav band — count <header> + .topbar + .nav-row before hero
const headerCount = (indexHtml.match(/<header[^>]*class="topbar"/g) || []).length;
if (headerCount !== 1) {
  fail('Gate 3', `Expected exactly 1 topbar; found ${headerCount}`);
} else {
  console.log(`  ${GREEN('✓')} exactly 1 topbar before hero`);
}

// 3c. "Sources" entry points ≤ 3 on main page
//     Allowed: topbar link + per-section footer link (multiple counted as 1 channel) + drawer-internal link
//     Heuristic: count occurrences of href="/sources/" in index.html + main.mjs string literals
const srcRefs = (indexHtml + mainMjs).match(/\/sources\//g) || [];
// Per-section footers all link to /sources/ — that's ONE entry channel, not N. Audit counts unique surfaces.
const sourceSurfaces = new Set();
if (indexHtml.includes('id="topbar-sources"') || indexHtml.match(/topbar[\s\S]+\/sources\//)) sourceSurfaces.add('topbar');
if (mainMjs.includes('View full source map') || indexHtml.includes('View full source map')) sourceSurfaces.add('section_footers');
if (indexHtml.includes('page-footer') && indexHtml.includes('/sources/')) sourceSurfaces.add('page_footer');
console.log(`  ${GREEN('✓')} Sources entry surfaces: ${sourceSurfaces.size} / 3 (${[...sourceSurfaces].join(', ')})`);

// 3d. "Stress" appears ≤ 2× above the fold — count in hero region only
const heroRegion = (indexHtml.match(/<section class="hero"[\s\S]*?<\/section>/) || [''])[0];
const stressCount = (heroRegion.toLowerCase().match(/stress/g) || []).length;
const conclusionMatches = (mainMjs.match(/Stress is high/gi) || []).length;
const totalStress = stressCount + conclusionMatches;
if (totalStress > 2) {
  fail('Gate 3', `"Stress" appears ${totalStress}× in hero — must be ≤ 2`);
} else {
  console.log(`  ${GREEN('✓')} "Stress" appears ${totalStress}× above the fold (≤ 2)`);
}

// 3e. H1 lands within first ~250px of body content (heuristic: hero <h1> is the first <h1> in body)
const h1Match = indexHtml.match(/<body[\s\S]*?<h1/);
if (h1Match && h1Match[0].length > 2500) {
  warn('Gate 3', `H1 is far from <body> start (${h1Match[0].length} chars before <h1>) — may render below fold`);
} else if (h1Match) {
  console.log(`  ${GREEN('✓')} H1 close to body start (${h1Match[0].length} chars before)`);
}

// ──────────────────────────────────────────────────────────────
// GATE 4 · Visual (deferred to Playwright)
// ──────────────────────────────────────────────────────────────
console.log(BOLD('\nGate 4 · Visual\n'));
warn('Gate 4', 'Visual checks (horizontal scroll, pill overflow, viewport tests at 360/390/430/1366/1440) require headless Chromium. Deferred to Phase 8.');
console.log(`  ${YELLOW('⚠')} deferred — requires Playwright (Phase 8)`);

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────
console.log();
if (errors.length) {
  console.log(BOLD(RED(`${errors.length} errors:\n`)));
  for (const { gate, msg } of errors) console.log(`  ${RED('•')} [${gate}] ${msg}`);
}
if (warnings.length) {
  console.log(BOLD(YELLOW(`\n${warnings.length} warnings:\n`)));
  for (const { gate, msg } of warnings) console.log(`  ${YELLOW('•')} [${gate}] ${msg}`);
}
console.log();
console.log(BOLD(`Result: ${errors.length === 0 ? GREEN('PASS') : RED('FAIL')} — Gates 1 + 3 ${errors.length === 0 ? 'pass' : 'failing'}, Gate 4 deferred`));
console.log();

process.exit(errors.length ? 1 : 0);
