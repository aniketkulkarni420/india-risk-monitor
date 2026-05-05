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

  // Suffix attached to formats that don't already carry a unit in the format itself.
  const u = (unit && unit.trim()) ? ' ' + unit.trim() : '';

  switch (value_format) {
    case 'integer':         return INR.format(Math.round(value)) + u;
    case 'decimal_1':       return value.toFixed(1) + u;
    case 'decimal_2':       return value.toFixed(2) + u;
    case 'percent':         return value.toFixed(2) + '%';
    case 'currency_inr_cr': return (value < 0 ? '−' : '') + '₹' + INR.format(Math.abs(Math.round(value))) + ' Cr';
    case 'currency_inr_lcr':return '₹' + value.toFixed(2) + ' L Cr';
    case 'currency_usd_bn': return '$' + value.toFixed(1) + ' Bn';
    case 'currency_usd_mn': return '$' + value.toFixed(1) + ' Mn';
    case 'currency_usd_per_unit': return '$' + INR.format(Math.round(value)) + (unit ? ' / ' + unit.replace(/^\/\s*/, '').trim() : '');
    case 'ratio_x':         return value.toFixed(2) + '×';
    case 'bps':             return (value > 0 ? '+' : '') + Math.round(value) + ' bps';
    case 'index':           return INR.format(Math.round(value)) + (unit ? ' ' + unit.trim() : '');
    case 'label':           return String(value);
    default:                return NUM.format(value) + u;
  }
}

// ──────────────────────────────────────────────────────────────
// Trend labels — period-aware
// Schema fields mom_pct + yoy_pct are POSITIONAL (first/second trend).
// Their displayed labels depend on as_of_period:
//   live, 24h     → 1D / 1W
//   weekly        → 1W / 1M
//   fortnightly   → 1W / 1M
//   monthly       → MoM / YoY
//   quarterly     → 1Q / 1Y
//   policy_event  → MoM / YoY (last change vs year-ago)
// ──────────────────────────────────────────────────────────────
export function trendLabels(as_of_period) {
  switch (as_of_period) {
    case 'live':
    case '24h':         return { primary: '1D',  secondary: '1W' };
    case 'weekly':      return { primary: '1W',  secondary: '1M' };
    case 'fortnightly': return { primary: '1W',  secondary: '1M' };
    case 'quarterly':   return { primary: '1Q',  secondary: '1Y' };
    case 'monthly':
    case 'policy_event':
    default:            return { primary: 'MoM', secondary: 'YoY' };
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

// Long-form as-of including year — used for viz titles where space allows
export function formatAsOfLong(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "as on …" prefixed asof, with optional period qualifier (Apr 2026, Q4 FY26 etc)
export function asOfLabel(iso, opts = {}) {
  if (!iso) return '';
  const long = formatAsOfLong(iso);
  return `as on ${long}`;
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
