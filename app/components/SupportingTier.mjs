// SupportingTier · 2026-05-12 · composite primitive
// (1) Auto-promote anomalies (high/shock + ★ followed) above the accordion
// (2) Summary label · "N normal · M needs review"
// (3) Change-event hint · metrics whose status flipped in last 24h
//
// Click row → 9D inline expand (now wired in TableRow.mjs). Keeps localStorage
// open/closed persistence + per-section key.

import { el, statusClass, formatTrend, pillWithDirection } from './utils.mjs';
import { renderTableRow, renderTableHeader } from './TableRow.mjs';

const STORAGE_KEY = 'irm.supporting.open';
const FOLLOWED_KEY = 'irm.followed';
const MAX_PROMOTED = 2;

function loadOpenState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveOpenState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}
function loadFollowed() {
  try { return JSON.parse(localStorage.getItem(FOLLOWED_KEY) || '[]'); } catch { return []; }
}

// Heuristic for "recently flipped" · uses sparkline_12m last two points
// where the last value is in stress band (high/shock thresholds via status)
// and previous wasn't. Simplification: status is current, but the act of
// flipping is captured by abs(dod_pct) > 5% as a proxy.
function isRecentFlip(m) {
  if (!m) return false;
  if (m.status === 'high' || m.status === 'shock') {
    const dod = Math.abs(m.dod_pct ?? 0);
    if (dod > 5) return true;
  }
  return false;
}

function renderPromotedStrip(m) {
  const pd = pillWithDirection(m);
  const dir = pd.direction || '';
  const trend = m.dod_pct ?? m.mom_pct ?? null;
  const trendText = trend == null ? '' : formatTrend(trend) + (m.dod_pct != null ? ' DoD' : ' MoM');
  return el('div', {
    class: 'st-promoted st-promoted-' + (m.status || 'med'),
    'data-metric-id': m.metric_id,
    onclick: () => { window.location.hash = `metric=${m.metric_id}`; }
  }, [
    el('span', { class: 'st-promoted-tag' }, m._followed ? '★ FOLLOWED' : 'PROMOTED'),
    el('span', { class: 'st-promoted-name' }, m.display_name || m.metric_id),
    el('span', { class: 'st-promoted-val' }, trendText),
    el('span', { class: 'pill ' + statusClass(m.status), style: { fontSize: '10px' } },
      pd.label + (dir ? ' ' + dir : '')),
    el('span', { class: 'st-promoted-arrow' }, '→')
  ]);
}

export function renderSupportingTier(metricIds, M, opts = {}) {
  const sectionId = opts.sectionId || 'unnamed';
  const title = opts.title || 'Supporting metrics';
  const allMetrics = metricIds.map(id => M(id)).filter(Boolean);
  if (!allMetrics.length) return el('div', {});

  // Tag followed metrics
  const followedSet = new Set(loadFollowed());
  allMetrics.forEach(m => { m._followed = followedSet.has(m.metric_id); });

  // Split: anomalies (high/shock or followed-with-non-low-status) → promoted
  const promoted = allMetrics.filter(m =>
    m.status === 'high' || m.status === 'shock' ||
    (m._followed && m.status !== 'low')
  ).slice(0, MAX_PROMOTED);

  const recentFlips = allMetrics.filter(m => !promoted.includes(m) && isRecentFlip(m));

  // Counts for summary label
  const counts = { low: 0, med: 0, high: 0, shock: 0 };
  allMetrics.forEach(m => { counts[m.status || 'low'] = (counts[m.status || 'low'] || 0) + 1; });
  const reviewCount = (counts.high || 0) + (counts.shock || 0);
  const normalCount = (counts.low || 0) + (counts.med || 0);
  const reviewDot = reviewCount > 0
    ? el('span', { class: 'st-review-dot', style: { color: reviewCount && counts.shock ? 'var(--red)' : 'var(--amber)' } }, '●')
    : null;
  const summary = el('span', { class: 'st-summary' }, [
    String(normalCount) + ' normal',
    reviewCount > 0 ? ' · ' + reviewCount + ' needs review ' : '',
    reviewDot
  ].filter(Boolean));

  const openState = loadOpenState();
  const isOpen = !!openState[sectionId];

  const wrap = el('div', { class: 'supporting-tier' + (isOpen ? ' open' : '') });

  // (1) Promoted anomalies strip
  if (promoted.length) {
    const promotedWrap = el('div', { class: 'st-promoted-list' },
      promoted.map(m => renderPromotedStrip(m)));
    wrap.appendChild(promotedWrap);
  }

  // (3) Change-event hint
  if (recentFlips.length) {
    const flipText = recentFlips.slice(0, 2).map(m =>
      `${m.display_name || m.metric_id} moved ${formatTrend(m.dod_pct)} in last 24h`
    ).join(' · ');
    wrap.appendChild(el('div', { class: 'st-changehint' }, '📍 ' + flipText));
  }

  // (2) Toggle accordion with summary
  const arrow = el('span', { class: 'st-arrow' }, '▾');
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
    el('span', {}, [title, ' · ', summary]),
    arrow
  ]);
  wrap.appendChild(toggleBtn);

  const body = el('div', { class: 'st-body' });
  const table = el('table', { class: 'metric-table' });
  // 2026-05-12 · Aniket rule · no sparkline column in supporting tier · click row → 9D inline expand reveals sparkline
  const thead = el('thead', {}, [renderTableHeader({
    labels: ['Metric', 'Current', 'Trend', 'Trend', 'Status'],
    hideSpark: true
  })]);
  const tbody = el('tbody');
  allMetrics.forEach(m => tbody.appendChild(renderTableRow(m, { hideSpark: true })));
  table.appendChild(thead);
  table.appendChild(tbody);
  body.appendChild(table);
  wrap.appendChild(body);

  return wrap;
}
