#!/usr/bin/env node
// Visual QA harness for headless screenshots.
// Usage: node scripts/qa-screenshot.mjs [url] [outDir]

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url    = process.argv[2] || 'https://india-risk-monitor.pages.dev/';
const outDir = resolve(__dirname, '..', process.argv[3] || 'qa-out');
mkdirSync(outDir, { recursive: true });

const SAMPLE_SELECTORS = [
  { name: 'heatmap-pos-strong', selector: '.heat-pos-strong',  limit: 3, captureRow: true  },
  { name: 'heatmap-neg-strong', selector: '.heat-neg-strong',  limit: 3, captureRow: true  },
  { name: 'heatmap-pos-mid',    selector: '.heat-pos-mid',     limit: 2, captureRow: true  },
  { name: 'heatmap-neg-mid',    selector: '.heat-neg-mid',     limit: 2, captureRow: true  },
  { name: 'pill-high',          selector: '.pill.pill-high',   limit: 3, captureRow: true  },
  { name: 'pill-shock',         selector: '.pill.pill-shock',  limit: 2, captureRow: true  },
  { name: 'pill-with-dir',      selector: '.pill .pill-dir',   limit: 3, captureRow: true  },
  { name: 'range-tick',         selector: '.range-tick-bar',   limit: 2, captureRow: false },
  { name: 'nuance-chip',        selector: '.nuance-chip',      limit: 3, captureRow: false },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: 'mobile',  width: 390,  height: 844, deviceScaleFactor: 2, isMobile: true },
];

const withTimeout = (p, ms, tag) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${tag}:${ms}ms`)), ms)),
]);

const browser = await chromium.launch({ headless: true });
const report = { url, generated_at: new Date().toISOString(), viewports: {} };

for (const vp of VIEWPORTS) {
  console.log(`[${vp.name}] start`);
  const ctx  = await browser.newContext({
    viewport:          { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile:          !!vp.isMobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror',  e => errors.push({ type: 'pageerror',  msg: e.message }));
  page.on('console',    m => { if (m.type() === 'error') errors.push({ type: 'console.error', msg: m.text() }); });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('table tbody tr', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);

  const vpDir = `${outDir}/${vp.name}`;
  mkdirSync(vpDir, { recursive: true });
  await withTimeout(page.screenshot({ path: `${vpDir}/full-page.png`, fullPage: true }), 30000, 'full-page');
  console.log(`[${vp.name}] full-page ok`);

  const samples = [];
  for (const s of SAMPLE_SELECTORS) {
    const handles = await page.$$(s.selector);
    if (handles.length === 0) {
      samples.push({ name: s.name, selector: s.selector, count: 0, missing: true });
      console.log(`[${vp.name}] ${s.name}: 0 found`);
      continue;
    }
    let captured = 0;
    for (let i = 0; i < Math.min(handles.length, s.limit); i++) {
      const h = handles[i];
      try {
        const path = `${vpDir}/${s.name}-${i}.png`;
        // Compute the bbox of either the element itself or its closest row (for table context).
        // Doing this in page.evaluate avoids ElementHandle wrapping issues.
        const boxInfo = await page.evaluate(({ sel, idx, useRow }) => {
          const nodes = document.querySelectorAll(sel);
          const node  = nodes[idx];
          if (!node) return null;
          const target = useRow ? (node.closest('tr') || node) : node;
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = target.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height,
                   pageX: r.left + window.scrollX, pageY: r.top + window.scrollY };
        }, { sel: s.selector, idx: i, useRow: s.captureRow });
        if (!boxInfo || boxInfo.width < 4 || boxInfo.height < 4) continue;
        await page.waitForTimeout(120); // let scroll settle
        const pad = 6;
        const x = Math.max(0, boxInfo.x - pad);
        const y = Math.max(0, boxInfo.y - pad);
        const w = Math.min(vp.width  - x, boxInfo.width  + pad * 2);
        const hPx = Math.min(vp.height - y, boxInfo.height + pad * 2);
        if (w < 4 || hPx < 4) continue;
        await withTimeout(page.screenshot({ path, clip: { x, y, width: w, height: hPx } }), 8000, `shot-${s.name}-${i}`);
        captured++;
        if (i === 0) {
          const info = await h.evaluate(node => {
            const cs = getComputedStyle(node);
            return {
              tag:        node.tagName.toLowerCase(),
              text:       (node.textContent || '').trim().slice(0, 80),
              className:  node.className,
              background: cs.backgroundColor,
              color:      cs.color,
              fontWeight: cs.fontWeight,
              fontSize:   cs.fontSize,
            };
          });
          samples.push({ name: s.name, index: 0, screenshot: path, ...info });
        }
      } catch (e) {
        console.log(`[${vp.name}] ${s.name}-${i} skipped: ${e.message}`);
      }
    }
    samples.push({ name: s.name, selector: s.selector, count: handles.length, captured });
    console.log(`[${vp.name}] ${s.name}: ${handles.length} found, ${captured} captured`);
  }

  report.viewports[vp.name] = { samples, console_errors: errors };
  await ctx.close();
  console.log(`[${vp.name}] done`);
}

await browser.close();
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(`OK · output at ${outDir}`);
