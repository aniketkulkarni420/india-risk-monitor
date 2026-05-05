// Shared formatters and helpers for the component library.
// Pure functions, no DOM. Imported by every component.

// ──────────────────────────────────────────────────────────────
// Value formatting — respects metric.value_format
// ──────────────────────────────────────────────────────────────
const INR = new Intl.NumberFormat('en-IN');
const NUM = new Intl.NumberFormat('en-US');

export function formatValue(value, value_format, unit) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number') return String(value);

  switch (value_format) {
    case 'integer':         return INR.format(Math.round(value));
    case 'decimal_1':       return value.toFixed(1);
    case 'decimal_2':       return value.toFixed(2);
    case 'percent':         return value.toFixed(2) + '%';
    case 'currency_inr_cr': return (value < 0 ? '−' : '') + '₹' + INR.format(Math.abs(Math.round(value)));
    case 'currency_inr_lcr':return '₹' + value.toFixed(2);
    case 'currency_usd_bn': return '$' + value.toFixed(1);
    case 'currency_usd_mn': return '$' + value.toFixed(1);
    case 'currency_usd_per_unit': return '$' + INR.format(Math.round(value));
    case 'ratio_x':         return value.toFixed(2) + '×';
    case 'bps':             return (value > 0 ? '+' : '') + Math.round(value);
    case 'index':           return INR.format(Math.round(value));
    case 'label':           return String(value);
    default:                return NUM.format(value);
  }
}

// ──────────────────────────────────────────────────────────────
// Trend formatting — adds sign + %
// ──────────────────────────────────────────────────────────────
export function formatTrend(pct) {
  if (pct === null || pct === undefined) return '—';
  const sign = pct > 0 ? '+' : '';
  return sign + pct.toFixed(1) + '%';
}

// ──────────────────────────────────────────────────────────────
// Trend colour — based on direction (good/bad/neutral) and sign
// ──────────────────────────────────────────────────────────────
export function trendClass(pct, trend_direction = 'neutral') {
  if (pct === null || pct === undefined || pct === 0) return 'trend-flat';
  if (trend_direction === 'neutral') return pct > 0 ? 'trend-up' : 'trend-dn';
  if (trend_direction === 'good')    return pct > 0 ? 'trend-pos' : 'trend-neg';
  if (trend_direction === 'bad')     return pct > 0 ? 'trend-neg' : 'trend-pos';
  return 'trend-flat';
}

// ──────────────────────────────────────────────────────────────
// Status pill class
// ──────────────────────────────────────────────────────────────
export function statusClass(status) {
  return `pill-${status}`; // pill-low, pill-med, pill-high, pill-shock
}

// ──────────────────────────────────────────────────────────────
// As-of formatter — short date, time only for live
// ──────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatAsOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// ──────────────────────────────────────────────────────────────
// DOM helper — concise element creator
// ──────────────────────────────────────────────────────────────
export function el(tag, attrs = {}, children = []) {
  const node = tag.includes('svg') || tag === 'path' || tag === 'polyline' || tag === 'polygon' ||
               tag === 'line' || tag === 'circle' || tag === 'text' || tag === 'rect' ||
               tag === 'defs' || tag === 'linearGradient' || tag === 'stop'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children).filter(c => c != null && c !== false)) {
    if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
  return node;
}

// ──────────────────────────────────────────────────────────────
// State helpers
// ──────────────────────────────────────────────────────────────
export function isHistoryPending(metric) {
  return metric.verification_state === 'history_pending' ||
         metric.mom_pct == null || metric.yoy_pct == null;
}
export function isShock(metric) { return metric.status === 'shock'; }
