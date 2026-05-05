// DisplayTile · Pattern 2 — tile + sparkline + MoM/YoY/5Y
// The Tier-1 metric primitive. Hero decks (×4), section primaries, mobile primary.
// Max 8 instances per page.
//
// Props:
//   metric: full metric object
//   size: 'hero' | 'section' | 'mobile'
//   show_5y: bool = true   — hide vs_5y_avg_pct on mobile if false
//   onClick: optional callback (default: open ?metric=metric_id deep-link)

import { el, formatValue, formatTrend, trendClass, statusClass, formatAsOf, isHistoryPending, isShock } from './utils.mjs';
import { renderSparkline } from './Sparkline.mjs';

function tileDetectState(metric, override) {
  if (override) return override;
  if (!metric) return 'error';
  if (isShock(metric)) return 'shock';
  if (isHistoryPending(metric)) return 'history-pending';
  return 'default';
}

function tileSkeleton(size) {
  return el('div', { class: `display-tile size-${size} state-loading` }, [
    el('div', { class: 'dt-label' }, '────────'),
    el('div', { class: 'dt-value-row' }, [el('div', { class: 'dt-value' }, '──────')]),
    el('div', { class: 'dt-trends' }, [el('div', { class: 'dt-trend' }, '─────')])
  ]);
}

function errorTile(size, message = 'fetch error') {
  return el('div', { class: `display-tile size-${size} state-error` }, [
    el('div', { class: 'dt-label', style: { color: 'var(--red)' } }, '✗ ERROR'),
    el('div', { class: 'dt-value', style: { fontSize: '14px', color: 'var(--ink-3)' } }, message)
  ]);
}

export function renderDisplayTile(metric, opts = {}) {
  const size = opts.size || 'section';
  const state = tileDetectState(metric, opts.state);
  const show_5y = opts.show_5y !== false;

  if (state === 'loading') return tileSkeleton(size);
  if (state === 'error')   return errorTile(size, opts.errorMessage);

  const dir = metric.trend_direction || 'neutral';

  const labelEl = el('div', { class: 'dt-label' }, state === 'shock' ? '⚠ SHOCK · ' + metric.display_name : metric.display_name);

  const valueRow = el('div', { class: 'dt-value-row' }, [
    el('div', { class: 'dt-value' }, formatValue(metric.value, metric.value_format, metric.unit)),
    metric.unit && metric.value_format !== 'label' && metric.value_format !== 'currency_inr_cr' && metric.value_format !== 'currency_inr_lcr'
      ? el('div', { class: 'dt-state' }, metric.unit)
      : null,
    size === 'hero' && metric.sparkline_12m?.length
      ? el('div', { style: { marginLeft: 'auto' } }, [renderSparkline({
          data: metric.sparkline_12m, width: 120, height: 32, fill: true, trend_direction: dir
        })])
      : null
  ].filter(Boolean));

  // Trends row
  let trendsContent;
  if (state === 'history-pending') {
    trendsContent = [el('div', { class: 'dt-history-pending' }, 'history pending — building from ' + formatAsOf(metric.last_verified_at))];
  } else {
    trendsContent = [];
    if (metric.mom_pct != null) trendsContent.push(
      el('div', { class: 'dt-trend ' + trendClass(metric.mom_pct, dir) }, [
        el('span', { class: 'lbl', style: { color: 'var(--ink-3)' } }, 'MoM'),
        el('b', {}, formatTrend(metric.mom_pct))
      ])
    );
    if (metric.yoy_pct != null) trendsContent.push(
      el('div', { class: 'dt-trend ' + trendClass(metric.yoy_pct, dir) }, [
        el('span', { class: 'lbl', style: { color: 'var(--ink-3)' } }, 'YoY'),
        el('b', {}, formatTrend(metric.yoy_pct))
      ])
    );
    if (show_5y && metric.vs_5y_avg_pct != null) trendsContent.push(
      el('div', { class: 'dt-trend' }, [
        el('span', { class: 'lbl', style: { color: 'var(--ink-3)' } }, 'vs 5Y'),
        el('b', { style: { color: 'var(--ink-2)' } }, formatTrend(metric.vs_5y_avg_pct))
      ])
    );
    if (metric.as_of) trendsContent.push(
      el('div', { class: 'dt-trend dt-asof' }, [
        el('span', { class: 'lbl', style: { color: 'var(--ink-3)' } }, 'As of'),
        el('b', { style: { color: 'var(--ink-2)' } }, formatAsOf(metric.as_of))
      ])
    );
  }
  const trendsRow = el('div', { class: 'dt-trends' }, trendsContent);

  // Inline sparkline below value (section/mobile sizes)
  const sparkBelow = (size !== 'hero' && metric.sparkline_12m?.length)
    ? el('div', { class: 'dt-spark' }, [renderSparkline({
        data: metric.sparkline_12m, width: size === 'mobile' ? 280 : 320, height: 28, fill: true, trend_direction: dir
      })])
    : null;

  return el('div', {
    class: `display-tile size-${size} state-${state}`,
    'data-metric-id': metric.metric_id,
    onclick: () => {
      if (opts.onClick) opts.onClick(metric);
      else window.location.hash = `metric=${metric.metric_id}`;
    }
  }, [labelEl, valueRow, sparkBelow, trendsRow].filter(Boolean));
}
