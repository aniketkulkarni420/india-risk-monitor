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

// ──────────────────────────────────────────────────────────────
// 2E Bloomberg-style heatmap cell · color intensity = magnitude
// Applied to MoM/YoY cells (not the full row · 12A keeps overall sparse).
// Returns a CSS class name based on % magnitude.
// ──────────────────────────────────────────────────────────────
export function heatmapClass(pct, trend_direction = 'neutral') {
  if (pct == null || pct === 0) return 'heat-neutral';
  const m = Math.abs(pct);
  // Magnitude buckets: light <2%, mid 2-10%, strong >10%
  let intensity = 'light';
  if (m >= 10) intensity = 'strong';
  else if (m >= 2) intensity = 'mid';
  // Direction: for 'good' direction (e.g. DII rising), positive = green
  let sign = pct > 0 ? 'pos' : 'neg';
  if (trend_direction === 'bad') sign = pct > 0 ? 'neg' : 'pos';
  return `heat-${sign}-${intensity}`;
}

// ──────────────────────────────────────────────────────────────
// 10B Status pill with direction
// Combines status with a trend direction indicator (↑5d / ↓3d / →)
// inferred from sparkline_12m last few points.
// ──────────────────────────────────────────────────────────────
export function pillWithDirection(metric) {
  const status = metric.status || 'neutral';
  const label = status === 'shock' ? 'SHOCK' : status.charAt(0).toUpperCase() + status.slice(1);
  const dir = computeDirection(metric);
  return { label, status, direction: dir };
}

function computeDirection(metric) {
  const spark = metric.sparkline_12m;
  if (!Array.isArray(spark) || spark.length < 3) return '';
  const last3 = spark.slice(-3).filter(v => typeof v === 'number');
  if (last3.length < 3) return '';
  const trend = (last3[2] - last3[0]) / (Math.abs(last3[0]) || 1);
  if (Math.abs(trend) < 0.02) return '→';
  // Count consecutive same-direction steps from end
  let streak = 1;
  const recent = spark.slice(-8).filter(v => typeof v === 'number');
  if (recent.length >= 3) {
    const direction = recent[recent.length - 1] > recent[recent.length - 2] ? 1 : -1;
    for (let i = recent.length - 2; i > 0; i--) {
      const stepDir = recent[i] > recent[i - 1] ? 1 : -1;
      if (stepDir === direction) streak++;
      else break;
    }
  }
  return (trend > 0 ? '↑' : '↓') + Math.min(streak, 99) + 'd';
}

// ──────────────────────────────────────────────────────────────
// 3A Range tick · 5Y range bar with current position + qualitative label
// Returns { positionPct, label, lo, hi } based on metric value vs sparkline range.
// ──────────────────────────────────────────────────────────────
export function rangeTick(metric) {
  const spark = metric.sparkline_12m;
  if (!Array.isArray(spark) || spark.length < 4) return null;
  const nums = spark.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 4) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (hi === lo) return null;
  const val = metric.value;
  if (typeof val !== 'number') return null;
  const pct = Math.max(0, Math.min(100, ((val - lo) / (hi - lo)) * 100));
  let label;
  if (pct >= 80) label = 'Near 12m high';
  else if (pct >= 60) label = 'Above average';
  else if (pct >= 40) label = 'Mid-range';
  else if (pct >= 20) label = 'Below average';
  else label = 'Near 12m low';
  return { positionPct: +pct.toFixed(1), label, lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
}
