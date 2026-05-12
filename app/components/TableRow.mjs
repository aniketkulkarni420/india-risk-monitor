// TableRow · Pattern 1 — compact dual-trend
// The dense metric primitive. ≥80% of metric renders use this.
//
// Cells: name+subtitle | current | MoM | YoY | sparkline | status pill
//
// Props:
//   metric: full metric object (or null for skeleton/error)
//   state: 'default' | 'loading' | 'error' | 'history-pending' | 'shock' (auto-detected from metric)
//   onClick: optional callback (default: open ?metric=metric_id deep-link)

import { el, formatValue, formatTrend, trendClass, statusClass, isHistoryPending, isShock, formatAsOf, heatmapClass, pillWithDirection } from './utils.mjs';
import { renderSparkline } from './Sparkline.mjs';
import { getDisplayPeriods } from './ComparisonSpec.mjs';

const PERIOD_FIELDS = { dod: 'dod_pct', mom: 'mom_pct', yoy: 'yoy_pct' };
const PERIOD_LABELS = { dod: 'DoD', mom: 'MoM', yoy: 'YoY' };

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

  const periods = (opts.periods != null) ? opts.periods : getDisplayPeriods(metric.metric_id);
  const TREND_SLOTS = 2;
  const visiblePeriods = periods.slice(0, TREND_SLOTS);

  // Inline the period label after the value so each cell is self-describing
  // even when different rows in the same table use different periods.
  const trendCells = state === 'history-pending'
    ? [el('td', { class: 'pending-cell', colspan: TREND_SLOTS }, 'history pending')]
    : (() => {
        const cells = visiblePeriods.map(p => {
          const val = metric[PERIOD_FIELDS[p]];
          if (val == null) {
            return el('td', { class: 'trend-cell', 'data-period': p, style: { color: 'var(--ink-3)' } }, '');
          }
          // 2E heatmap: only on monthly/yearly trend cells (MoM/YoY/1M/1Y)
          // Daily/weekly trends keep sparse color (12A) since these flap intra-day.
          const useHeatmap = ['mom_pct', 'yoy_pct'].includes(PERIOD_FIELDS[p]);
          const cls = useHeatmap
            ? 'trend-cell ' + heatmapClass(val, dir)
            : 'trend-cell ' + trendClass(val, dir);
          return el('td', { class: cls, 'data-period': p }, [
            formatTrend(val),
            ' ',
            el('span', { style: { color: 'var(--ink-3)', fontSize: '10px', marginLeft: '3px' } }, PERIOD_LABELS[p])
          ]);
        });
        while (cells.length < TREND_SLOTS) {
          cells.push(el('td', { class: 'trend-cell', style: { color: 'var(--ink-3)' } }, ''));
        }
        return cells;
      })();

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
    ...trendCells,
    el('td', { class: 'spark-cell' }, [
      // Only render the sparkline when there's real history (≥4 unique values).
      // Otherwise show a "data verifying" progress badge to be honest about
      // V1 data depth + signal that the platform is improving in real time.
      (() => {
        const sl = metric.sparkline_12m || [];
        const uniqueCount = new Set(sl.filter(v => v != null)).size;
        if (uniqueCount >= 4) {
          return renderSparkline({ data: sl, width: 80, height: 22, trend_direction: dir });
        }
        // Progress badge · X of 12 days collected
        const target = 12;
        const filled = Math.min(uniqueCount, target);
        const ticks = [];
        for (let i = 0; i < target; i++) {
          ticks.push(el('span', {
            style: {
              width: '4px',
              height: '8px',
              borderRadius: '1px',
              background: i < filled ? 'var(--accent)' : 'var(--line-2)',
              flexShrink: 0
            }
          }));
        }
        return el('span', {
          class: 'data-verifying-badge',
          title: `Historical series accruing. ${filled} of ${target} consistent readings collected. Chart returns when ≥4 unique values present.`,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }
        }, [
          el('span', {
            style: { display: 'inline-flex', gap: '1.5px', alignItems: 'center' }
          }, ticks),
          el('span', {
            style: {
              fontSize: '9px',
              color: 'var(--ink-3)',
              fontFamily: 'var(--mono)',
              fontStyle: 'italic',
              whiteSpace: 'nowrap'
            }
          }, `history accruing · ${filled}/${target} months`)
        ]);
      })()
    ]),
    el('td', { class: 'status-cell' }, [
      sourcePill(metric.source_primary?.name),
      metric.as_of ? el('span', { class: 'asof-pill', title: 'Data as of ' + new Date(metric.as_of).toString(), style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-3)', marginRight: '4px' } }, formatAsOf(metric.as_of)) : null,
      // STALE pill · surfaced when (age - cadence) flags freshness-spec.mjs
      metric.is_stale ? el('span', {
        class: 'stale-pill',
        title: `Last updated ${metric.age_days}d ago · expected refresh every ${metric.cadence_days}d. Source ingest may be lagging or upstream publication delayed.`
      }, 'STALE ' + metric.age_days + 'd') : null,
      (() => {
        // 10B: status pill with direction
        const pd = pillWithDirection(metric);
        const label = state === 'shock' ? 'SHOCK' : pd.label;
        const children = [label];
        if (pd.direction) children.push(el('span', { class: 'pill-dir' }, pd.direction));
        return el('span', { class: 'pill ' + statusClass(metric.status), title: pd.direction ? `${label} · ${pd.direction.replace('↑','up ').replace('↓','down ').replace('→','flat')}` : label }, children);
      })()
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
