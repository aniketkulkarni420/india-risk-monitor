// Deep mobile audit · iterate each tab × each viewport, surface every overflow.
// Run via: node scripts/overflow-probe.mjs
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8080/app/';
const VIEWPORTS = [
  { name: '360', w: 360, h: 800 },
  { name: '390', w: 390, h: 844 },
  { name: '430', w: 430, h: 932 },
  { name: '768', w: 768, h: 1024 },
  { name: '1366', w: 1366, h: 768 },
  { name: '1440', w: 1440, h: 900 }
];
const TABS = ['flows', 'macro', 'economy', 'freight', 'market', 'sectors', 'all'];

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();

const report = [];

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  for (const tab of TABS) {
    await page.goto(URL + '#' + tab, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const result = await page.evaluate(({ tab, vpw }) => {
      const out = { tab, issues: [] };

      // 1 · section-frame visibility
      const frames = Array.from(document.querySelectorAll('.section-frame'));
      const visible = frames.filter(f => f.offsetParent !== null && f.getBoundingClientRect().height > 10);
      out.frameCount = frames.length;
      out.visibleFrameCount = visible.length;
      out.visibleSections = visible.map(f => f.dataset.section);
      out.bodyActiveTab = document.body.dataset.activeTab;

      if (tab !== 'all' && visible.length === 0) {
        out.issues.push({ kind: 'no_visible_section', detail: `tab=${tab} but no .section-frame is visible` });
      }
      if (tab !== 'all' && visible.length > 1) {
        out.issues.push({ kind: 'multiple_visible_sections', detail: `tab=${tab} but ${visible.length} frames visible: ${out.visibleSections.join(', ')}` });
      }

      // 2 · doc width vs viewport
      const docW = document.documentElement.scrollWidth;
      out.docWidth = docW;
      if (docW > vpw + 1) {
        out.issues.push({ kind: 'page_horizontal_scroll', detail: `doc=${docW}px > viewport=${vpw}px` });
      }

      // 3 · find every element whose right edge overflows viewport
      const overflowing = [];
      const all = document.querySelectorAll('main *, .hero *, .risk-ticker *');
      all.forEach(n => {
        const r = n.getBoundingClientRect();
        if (r.width === 0) return;
        if (r.right > vpw + 1) {
          // Skip if any ancestor is overflow-x:auto/scroll (intentional scroll)
          let p = n.parentElement;
          let intentional = false;
          while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll') {
              intentional = true;
              break;
            }
            p = p.parentElement;
          }
          if (!intentional) {
            const id = n.id ? '#' + n.id : '';
            const cls = (n.className && typeof n.className === 'string') ? '.' + n.className.split(' ').slice(0, 2).join('.') : '';
            overflowing.push({
              sel: n.tagName.toLowerCase() + id + cls,
              right: Math.round(r.right),
              w: Math.round(r.width)
            });
          }
        }
      });
      // De-dupe by selector, keep worst offender
      const seen = new Map();
      overflowing.forEach(o => {
        const cur = seen.get(o.sel);
        if (!cur || o.right > cur.right) seen.set(o.sel, o);
      });
      const top = Array.from(seen.values()).sort((a, b) => b.right - a.right).slice(0, 8);
      if (top.length) out.issues.push({ kind: 'element_overflow', count: seen.size, top });

      // 4 · body transform sanity (swipe handler residue)
      const bodyEl = document.getElementById('body');
      if (bodyEl) {
        const t = getComputedStyle(bodyEl).transform;
        if (t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)') {
          out.issues.push({ kind: 'body_transform_residue', detail: t });
        }
      }

      return out;
    }, { tab, vpw: vp.w });

    report.push({ vp: vp.name, ...result });
  }
}

await browser.close();

// Print compact report
console.log('\n=== Overflow probe ===\n');
for (const r of report) {
  const tag = r.issues.length === 0 ? 'OK' : 'FAIL';
  console.log(`[${tag}] vp=${r.vp} tab=${r.tab} · activeTab=${r.bodyActiveTab} · visible=${r.visibleFrameCount}/${r.frameCount} (${r.visibleSections.join(',')}) · docW=${r.docWidth}`);
  for (const iss of r.issues) {
    if (iss.kind === 'element_overflow') {
      console.log(`   ${iss.kind} (${iss.count} elements)`);
      iss.top.forEach(o => console.log(`     · ${o.sel} right=${o.right} w=${o.w}`));
    } else {
      console.log(`   ${iss.kind}: ${iss.detail || ''}`);
    }
  }
}

const failures = report.filter(r => r.issues.length).length;
console.log(`\n${failures}/${report.length} probe runs had issues.`);
process.exit(failures ? 1 : 0);
