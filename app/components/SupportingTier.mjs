// SupportingTier · 2026-05-06
// Collapsible expander for Tier-2 metrics that live below the headline
// chart panels in each section. Web → sparkline-augmented rows (existing
// renderTableRow with COMPARISON_SPEC filter). Mobile → same content; the
// existing mobile CSS rules in styles.css already convert .metric-table tr
// into a card grid layout, so no separate mobile renderer is needed.
//
// Persistence: open/closed state per-section persists in localStorage so
// users who always want supporting open don't have to re-click each load.

import { el } from './utils.mjs';
import { renderTableRow, renderTableHeader } from './TableRow.mjs';

const STORAGE_KEY = 'irm.supporting.open';

function loadOpenState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function saveOpenState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// renderSupportingTier(metricIds, M, opts)
//   metricIds: array of metric_id strings
//   M: lookup function (metric_id) → metric object
//   opts.sectionId: string · used as the key for open/closed persistence
//   opts.title: string · displayed in toggle button (default 'Supporting metrics')
export function renderSupportingTier(metricIds, M, opts = {}) {
  const sectionId = opts.sectionId || 'unnamed';
  const title = opts.title || 'Supporting metrics';
  const metrics = metricIds.map(id => M(id)).filter(Boolean);
  if (!metrics.length) return el('div', {});

  const openState = loadOpenState();
  const isOpen = !!openState[sectionId];

  const wrap = el('div', { class: 'supporting-tier' + (isOpen ? ' open' : '') });

  const arrow = el('span', { class: 'st-arrow' }, '▼');
  const toggleBtn = el('button', {
    class: 'st-toggle',
    'aria-expanded': String(isOpen),
    onclick: () => {
      const nowOpen = !wrap.classList.contains('open');
      wrap.classList.toggle('open', nowOpen);
      toggleBtn.setAttribute('aria-expanded', String(nowOpen));
      const state = loadOpenState();
      state[sectionId] = nowOpen;
      saveOpenState(state);
    }
  }, [
    el('span', {}, [
      title,
      ' ',
      el('span', { class: 'st-count' }, String(metrics.length))
    ]),
    arrow
  ]);
  wrap.appendChild(toggleBtn);

  const body = el('div', { class: 'st-body' });
  const table = el('table', { class: 'metric-table' });
  const thead = el('thead', {}, [renderTableHeader({
    labels: ['Metric', 'Current', 'Trend', 'Trend', '12m', 'Status']
  })]);
  const tbody = el('tbody');
  metrics.forEach(m => tbody.appendChild(renderTableRow(m)));
  table.appendChild(thead);
  table.appendChild(tbody);
  body.appendChild(table);
  wrap.appendChild(body);

  return wrap;
}
