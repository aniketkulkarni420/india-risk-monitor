// TableRow · Pattern 1 — compact dual-trend
// The dense metric primitive. ≥80% of metric renders use this.
//
// Cells: name+subtitle | current | MoM | YoY | sparkline | status pill
//
// Props:
//   metric: full metric object (or null for skeleton/error)
//   state: 'default' | 'loading' | 'error' | 'history-pending' | 'shock' (auto-detected from metric)
//   onClick: optional callback (default: open ?metric=metric_id deep-link)

import { el, formatValue, formatTrend, trendClass, statusClass, isHistoryPending, isShock, formatAsOf } from './utils.mjs';
import { renderSparkline } from './Sparkline.mjs';

function rowDetectState(metric, override) {
  if (override) return override;
  if (!metric) return 'error';
  if (isShock(metric)) return 'shock';
  if (isHistoryPending(metric)) return 'history-pending';
  return 'default';
}

// Compact source name for the per-row pill — strip noise, max 14 chars
function sourceShort(name) {
  if (!name) return '';
  return name
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/^(IRM derived|Office of Economic Adviser).*$/i, m => m.startsWith('IRM') ? 'derived' : 'OEA')
    .replace(/Indian Railways.*/, 'Railways')
    .replace(/Min of Ports.*/, 'MoPorts')
    .replace(/Baltic Dirty Tanker Index.*/, 'Baltic')
    .replace(/Baltic Exchange.*/, 'Baltic')
    .replace(/Drewry weekly press release/, 'Drewry')
    .replace(/RBI .*/, 'RBI')
    .replace(/MoSPI .*/, 'MoSPI')
    .replace(/CGA .*/, 'CGA')
    .replace(/NSE .*/, 'NSE')
    .replace(/NSDL .*/, 'NSDL')
    .replace(/^.* press release$/, m => m.split(' ')[0])
    .slice(0, 14);
}

function sourcePill(name) {
  const short = sourceShort(name);
  if (!short) return null;
  return el('span', { class: 'src-pill', title: name }, short);
}

function rowSkeleton() {
  return el('tr', { class: 'tr-loading' }, [
    el('td', { class: 'name' }, [el('span', { class: 'skel', style: { width: '70%' } })]),
    el('td', { class: 'num' }, [el('span', { class: 'skel', style: { width: '60%' } })]),
    el('td', { class: 'trend-cell' }, [el('span', { class: 'skel', style: { width: '70%' } })]),
    el('td', { class: 'trend-cell' }, [el('span', { class: 'skel', style: { width: '70%' } })]),
    el('td', { class: 'spark-cell' }, [el('span', { class: 'skel', style: { width: '80px' } })]),
    el('td', { class: 'status-cell' }, [el('span', { class: 'skel', style: { width: '40px' } })])
  ]);
}

function errorRow(metric_id, msg = 'fetch error') {
  return el('tr', { class: 'tr-error' }, [
    el('td', { class: 'name', colspan: 6 }, [
      el('span', { style: { color: 'var(--red)' } }, '✗ '),
      metric_id || 'unknown',
      el('small', {}, msg)
    ])
  ]);
}

export function renderTableRow(metric, opts = {}) {
  const state = rowDetectState(metric, opts.state);

  if (state === 'loading') return rowSkeleton();
  if (state === 'error')   return errorRow(metric?.metric_id, opts.errorMessage);

  const dir = metric.trend_direction || 'neutral';
  const klass = state === 'shock' ? 'tr-shock' : '';

  const tr = el('tr', {
    class: klass,
    'data-metric-id': metric.metric_id,
    onclick: () => {
      if (opts.onClick) opts.onClick(metric);
      else window.location.hash = `metric=${metric.metric_id}`;
    }
  }, [
    el('td', { class: 'name' }, [
      metric.display_name,
      metric.display_subtitle ? el('small', {}, metric.display_subtitle) : null
    ]),
    el('td', { class: 'num' }, formatValue(metric.value, metric.value_format, metric.unit)),
    state === 'history-pending'
      ? el('td', { class: 'pending-cell', colspan: 2 }, 'history pending')
      : el('td', { class: 'trend-cell ' + trendClass(metric.mom_pct, dir) }, formatTrend(metric.mom_pct)),
    state === 'history-pending'
      ? null
      : el('td', { class: 'trend-cell ' + trendClass(metric.yoy_pct, dir) }, formatTrend(metric.yoy_pct)),
    el('td', { class: 'spark-cell' }, [
      // Only render the sparkline when there's real history (≥4 unique values).
      // Otherwise show a tiny "pending" pill to be honest about V1 data depth.
      (() => {
        const sl = metric.sparkline_12m || [];
        const uniqueCount = new Set(sl.filter(v => v != null)).size;
        if (uniqueCount >= 4) {
          return renderSparkline({ data: sl, width: 80, height: 22, trend_direction: dir });
        }
        return el('span', {
          style: {
            fontSize: '9px',
            color: 'var(--ink-3)',
            fontFamily: 'var(--mono)',
            fontStyle: 'italic',
            opacity: 0.7
          },
          title: 'Historical series accruing · returns when 12 unique readings collected'
        }, 'history pending');
      })()
    ]),
    el('td', { class: 'status-cell' }, [
      // Per-row source pill (Design Audit §12 · trust signal at scan-time)
      sourcePill(metric.source_primary?.name),
      // Per-row as-of stamp — every metric must show when its data is from
      metric.as_of ? el('span', { class: 'asof-pill', title: 'Data as of ' + new Date(metric.as_of).toString(), style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-3)', marginRight: '4px' } }, formatAsOf(metric.as_of)) : null,
      el('span', { class: 'pill ' + statusClass(metric.status) }, state === 'shock' ? 'SHOCK' : metric.status.charAt(0).toUpperCase() + metric.status.slice(1))
    ].filter(Boolean))
  ].filter(Boolean));

  return tr;
}

// Helper for header row
export function renderTableHeader(opts = {}) {
  const labels = opts.labels || ['Metric', 'Current', 'MoM', 'YoY', '12m', 'Status'];
  return el('tr', {}, [
    el('th', {}, labels[0]),
    el('th', { style: { textAlign: 'right' } }, labels[1]),
    el('th', { style: { textAlign: 'right' } }, labels[2]),
    el('th', { style: { textAlign: 'right' } }, labels[3]),
    el('th', { style: { textAlign: 'right' } }, labels[4]),
    el('th', { style: { textAlign: 'right' } }, labels[5])
  ]);
}
