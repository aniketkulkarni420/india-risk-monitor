#!/usr/bin/env node
// Build a single self-contained preview HTML — opens via file://.
// Bundles: data.json + styles.css + 9 component .mjs files + page logic
// Toggles between desktop and mobile views.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join('C:/Users/anike/Downloads', 'IRM_Preview.html');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ──────────────────────────────────────────────────────────────
// Strip import/export lines so we can concatenate as a single module
// ──────────────────────────────────────────────────────────────
function stripImports(src) {
  return src
    // Multi-line: import { a, b, ... } from './x.mjs';
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    // Default/single-line: import x from './y.mjs';
    .replace(/^import\s+[^{][^\n]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    // Side-effect: import './x.mjs';
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    // export keyword on declarations
    .replace(/^export\s+(function|const|let|var|class|async)/gm, '$1')
    // Re-export blocks
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
}

// Component bundle (in dependency order)
const components = [
  'app/components/utils.mjs',
  'app/components/Sparkline.mjs',
  'app/components/Band.mjs',
  'app/components/DisplayTile.mjs',
  'app/components/TableRow.mjs',
  'app/components/SectionFrame.mjs',
  'app/components/StickyTOC.mjs',
  'app/components/MetricDrawer.mjs',
  'app/components/CmdKPalette.mjs',
  'app/components/charts.mjs'
].map(f => `\n// === ${f} ===\n${stripImports(read(f))}`).join('\n');

// No aliases needed — components keep their function names after `export` strip.
// `wire as wireDrawer` import alias rewrites to `wire(` since MetricDrawer's
// fn IS `wire` after stripping; CmdK uses `wireCmdK`/`openCmdK` natively.
const exportAliases = '';

// Main desktop & mobile logic — strip imports, replace fetch with const data
let desktopMain = stripImports(read('app/main.mjs'))
  .replace(/let\s+DATA;[\s\S]*?throw err;\s*\}/, '__DESKTOP_DATA_INIT__')
  .replace(/\bwireDrawer\b/g, 'wire')
  .replace(/\bopenDrawer\b/g, 'open');

let mobileMain = stripImports(read('app/m/main.mjs'))
  .replace(/let\s+DATA;[\s\S]*?throw err;\s*\}/, '__MOBILE_DATA_INIT__')
  .replace(/\bwireDrawer\b/g, 'wire')
  .replace(/\bopenDrawer\b/g, 'open');

const styles = read('app/components/styles.css');

// Inline data
const data = JSON.parse(readFileSync(join(ROOT, 'app/dist/data.json'), 'utf8'));
const dataJSON = JSON.stringify(data);

// Replace data init blocks with synchronous lookup
desktopMain = desktopMain.replace('__DESKTOP_DATA_INIT__', 'const DATA = window.__IRM_DATA__;');
mobileMain  = mobileMain.replace('__MOBILE_DATA_INIT__',  'const DATA = window.__IRM_DATA__;');

// Read original page styles from desktop and mobile shells (excluding <style> tags)
function extractStyles(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}
const desktopStyles = extractStyles(read('app/index.html'));
const mobileStyles  = extractStyles(read('app/m/index.html'));

// Read body content from each shell (between <body> and </body>, but skip <script> tags)
function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  let body = m ? m[1] : '';
  body = body.replace(/<script[\s\S]*?<\/script>/g, '');
  return body.trim();
}
const desktopBody = extractBody(read('app/index.html'));
const mobileBody  = extractBody(read('app/m/index.html'));

// ──────────────────────────────────────────────────────────────
// Compose
// ──────────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IRM Preview · Desktop + Mobile</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${styles}
${desktopStyles}
${mobileStyles}

/* ─── Preview-doc shell ─── */
body { background: #050709; }
.preview-bar {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 200;
  background: var(--surface); border: 1px solid var(--line); border-radius: 999px;
  padding: 4px; display: flex; gap: 4px;
  font-family: var(--sans); font-size: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.5);
}
.preview-bar button {
  background: transparent; border: none; color: var(--ink-3);
  padding: 6px 14px; border-radius: 999px; cursor: pointer;
  font-family: var(--sans); font-weight: 500; letter-spacing: .02em;
}
.preview-bar button.active { background: var(--accent); color: #1a1206; }

/* Desktop view container — already styled */
#desktop-view { display: block; }
#mobile-view  { display: none; }
[data-view="mobile"] #desktop-view { display: none; }
[data-view="mobile"] #mobile-view  { display: block; }

/* Phone frame for the mobile view */
#mobile-view {
  margin: 60px auto 80px;
  width: 390px; max-width: calc(100vw - 40px);
  background: var(--bg);
  border: 12px solid #1a1d22;
  border-radius: 36px;
  box-shadow: 0 24px 60px rgba(0,0,0,.6), inset 0 0 0 1px #2a2d33;
  overflow: hidden;
  position: relative;
  height: 844px; max-height: calc(100vh - 80px);
}
#mobile-view .m-content {
  height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch;
  position: relative;
}
#mobile-view .m-topbar { position: sticky; top: 0; }
/* Drawer renders to body — keep it global; on mobile view the drawer width is already 100vw */
@media (max-width: 480px) { #mobile-view { width: 100%; border: none; border-radius: 0; height: auto; } }
</style>
</head>
<body data-view="desktop">

<!-- Toggle bar -->
<nav class="preview-bar" role="tablist" aria-label="Preview viewport">
  <button id="btn-desktop" class="active" data-target="desktop">Desktop</button>
  <button id="btn-mobile" data-target="mobile">Mobile · 390</button>
</nav>

<!-- Desktop view -->
<div id="desktop-view">
  ${desktopBody}
</div>

<!-- Mobile view — wrapped in a phone frame -->
<div id="mobile-view" aria-label="Mobile preview">
  <div class="m-content">
    ${mobileBody}
  </div>
</div>

<script>
  // Inline data — same bundle the live app fetches
  window.__IRM_DATA__ = ${dataJSON};

  // Toggle handler
  const setView = (v) => {
    document.body.dataset.view = v;
    document.querySelectorAll('.preview-bar button').forEach(b =>
      b.classList.toggle('active', b.dataset.target === v));
    history.replaceState(null, '', '#view=' + v);
    window.scrollTo(0, 0);
  };
  document.getElementById('btn-desktop').addEventListener('click', () => setView('desktop'));
  document.getElementById('btn-mobile').addEventListener('click',  () => setView('mobile'));
  if (location.hash.includes('view=mobile')) setView('mobile');
</script>

<script type="module">
${components}
${exportAliases}

// ── Desktop assembly
(function buildDesktop() {
  // Scope the desktop assembly to the desktop-view container so selectors don't collide
  const root = document.getElementById('desktop-view');
  const $ = (id) => root.querySelector('#' + id);
  // Override document.getElementById within this scope so the ported main.mjs works
  const origGet = document.getElementById.bind(document);
  document.getElementById = (id) => root.querySelector('#' + id) || origGet(id);
  try {
    ${desktopMain}
  } finally {
    document.getElementById = origGet;
  }
})();

// ── Mobile assembly (with scoped getElementById)
(function buildMobile() {
  const root = document.getElementById('mobile-view');
  const origGet = document.getElementById.bind(document);
  document.getElementById = (id) => root.querySelector('#' + id) || origGet(id);
  try {
    ${mobileMain}
  } finally {
    document.getElementById = origGet;
  }
})();
</script>

</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`✓ self-contained preview written to:`);
console.log(`  ${OUT}`);
console.log(`  ${(html.length / 1024).toFixed(1)} KB · open via file:// or double-click`);
