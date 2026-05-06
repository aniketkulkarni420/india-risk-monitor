// MetricDrawer · slide-from-right panel.
// Opens on any DisplayTile/TableRow click. Contains everything stripped from the
// old V60 KPI card: full chart with period selector, why_it_matters, formula,
// trigger_thresholds, source_primary + source_crosscheck, linked_metrics,
// watch_next, alternate views.
//
// URL-shareable: updates ?metric= so a drawer state is deep-linkable.
//
// Singleton pattern: one drawer mounted to <body>; open(metric) / close() / wire()
//
// API:
//   wire(metricLookup)  — called once on app boot. metricLookup: (id) => metric|null
//   open(metric_id)     — opens the drawer for a metric
//   close()             — closes
//
// The drawer respects the data contract — every field in the schema can render here.

import { el, formatValue, formatTrend, trendClass, statusClass, formatAsOf, isHistoryPending, trendLabels } from './utils.mjs';
import { renderSparkline } from './Sparkline.mjs';
import { renderBand } from './Band.mjs';

let _drawer = null;
let _backdrop = null;
let _lookup = null;
let _open = false;

const PERIOD_OPTIONS = ['1M', '3M', '6M', '1Y', '5Y'];

function ensureMounted() {
  if (_drawer) return;

  _backdrop = el('div', {
    class: 'md-backdrop',
    onclick: close
  });

  _drawer = el('aside', {
    class: 'metric-drawer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-hidden': 'true'
  });

  document.body.appendChild(_backdrop);
  document.body.appendChild(_drawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) close();
  });

  // Touch · drag-to-close on mobile (bottom-sheet pattern)
  // Active only on viewports ≤700px where the drawer opens from bottom.
  let touchStartY = null;
  let touchCurrentY = null;
  let dragging = false;
  _drawer.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 700) return;
    // Only enable drag if touched on top portion (drag-handle / first 60px)
    const rect = _drawer.getBoundingClientRect();
    if (e.touches[0].clientY - rect.top > 60) return;
    touchStartY = e.touches[0].clientY;
    touchCurrentY = touchStartY;
    dragging = true;
    _drawer.style.transition = 'none';
  }, { passive: true });
  _drawer.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    touchCurrentY = e.touches[0].clientY;
    const dy = touchCurrentY - touchStartY;
    if (dy > 0) {
      _drawer.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });
  _drawer.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    _drawer.style.transition = '';
    const dy = (touchCurrentY ?? touchStartY) - touchStartY;
    _drawer.style.transform = '';
    if (dy > 100) close();
  });

  // React to URL hash changes (deep-linking)
  window.addEventListener('hashchange', syncFromHash);
}

function syncFromHash() {
  const h = window.location.hash.slice(1);
  const params = new URLSearchParams(h);
  const id = params.get('metric');
  if (id && (!_open || _drawer.dataset.metricId !== id)) open(id, { silent: true });
  else if (!id && _open) close({ silent: true });
}

export function wire(metricLookup) {
  _lookup = metricLookup;
  ensureMounted();
  syncFromHash();
}

export function open(metric_id, opts = {}) {
  ensureMounted();
  if (!_lookup) {
    console.warn('[MetricDrawer] not wired — call wire(lookup) on boot');
    return;
  }
  const metric = _lookup(metric_id);
  if (!metric) {
    renderError(metric_id, 'Metric not found');
    return _show(metric_id, opts);
  }
  renderContent(metric);
  _show(metric_id, opts);
}

export function close(opts = {}) {
  if (!_drawer) return;
  _drawer.classList.remove('open');
  _drawer.setAttribute('aria-hidden', 'true');
  _backdrop.classList.remove('open');
  _open = false;
  if (!opts.silent) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

function _show(metric_id, opts) {
  _drawer.dataset.metricId = metric_id;
  _drawer.classList.add('open');
  _drawer.setAttribute('aria-hidden', 'false');
  _backdrop.classList.add('open');
  _open = true;
  if (!opts.silent) {
    history.replaceState(null, '', '#metric=' + metric_id);
  }
}

// ──────────────────────────────────────────────────────────────
// Drawer content — sections in render order
// ──────────────────────────────────────────────────────────────
function renderError(metric_id, message) {
  _drawer.innerHTML = '';
  _drawer.appendChild(el('div', { class: 'md-pad' }, [
    el('button', { class: 'md-close', onclick: close, 'aria-label': 'Close' }, '×'),
    el('h2', { class: 'md-title' }, metric_id || 'Unknown metric'),
    el('p', { style: { color: 'var(--red)' } }, message)
  ]));
}

function renderContent(metric) {
  const dir = metric.trend_direction || 'neutral';
  const isPending = isHistoryPending(metric);

  _drawer.innerHTML = '';
  const pad = el('div', { class: 'md-pad' });

  // Header — close button + status pill + title
  pad.appendChild(el('button', { class: 'md-close', onclick: close, 'aria-label': 'Close' }, '×'));

  pad.appendChild(el('div', { class: 'md-status-row' }, [
    el('span', { class: 'pill ' + statusClass(metric.status) }, metric.status === 'shock' ? 'SHOCK' : metric.status[0].toUpperCase() + metric.status.slice(1)),
    el('span', { class: 'md-section-tag' }, metric.section + (metric.sub_cluster ? ' · ' + metric.sub_cluster : ''))
  ]));

  pad.appendChild(el('h2', { class: 'md-title' }, metric.display_name));
  if (metric.display_subtitle) {
    pad.appendChild(el('p', { class: 'md-subtitle' }, metric.display_subtitle));
  }

  // Big value + trends
  const valueRow = el('div', { class: 'md-value-row' }, [
    el('div', { class: 'md-value' }, formatValue(metric.value, metric.value_format, metric.unit)),
    el('div', { class: 'md-unit' }, metric.unit)
  ]);
  pad.appendChild(valueRow);

  if (isPending) {
    pad.appendChild(el('p', { class: 'md-history-pending' },
      'history pending — building from ' + formatAsOf(metric.last_verified_at)));
  } else {
    const labels = trendLabels(metric.as_of_period);
    const trendsRow = el('div', { class: 'md-trends' }, [
      metric.mom_pct != null ? trendCell(labels.primary, formatTrend(metric.mom_pct), trendClass(metric.mom_pct, dir)) : null,
      metric.yoy_pct != null ? trendCell(labels.secondary, formatTrend(metric.yoy_pct), trendClass(metric.yoy_pct, dir)) : null,
      metric.vs_5y_avg_pct != null ? trendCell('vs 5Y', formatTrend(metric.vs_5y_avg_pct), '') : null,
      metric.baseline_30d != null ? trendCell('30d baseline', formatValue(metric.baseline_30d, metric.value_format, metric.unit), '') : null,
      metric.as_of ? trendCell('As of', formatAsOf(metric.as_of), '') : null
    ].filter(Boolean));
    pad.appendChild(trendsRow);
  }

  // Period selector + chart — Phase 8 wired to data/history/{metric_id}.csv
  pad.appendChild(el('div', { class: 'md-section-head' }, 'History chart'));
  const periodRow = el('div', { class: 'md-period-row' },
    PERIOD_OPTIONS.map(p => el('button', {
      class: 'md-period' + (p === '1Y' ? ' active' : ''),
      'data-period': p,
      onclick: (e) => {
        pad.querySelectorAll('.md-period').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        renderChart(p);
      }
    }, p))
  );
  pad.appendChild(periodRow);

  const chartHost = el('div', { class: 'md-chart' });
  pad.appendChild(chartHost);

  // Lazy-load historical CSV; cache by metric_id on the closure
  let historyCache = null;
  async function loadHistory() {
    if (historyCache) return historyCache;
    try {
      const res = await fetch(`../data/history/${metric.metric_id}.csv`);
      if (!res.ok) throw new Error('no history file');
      const text = await res.text();
      const lines = text.trim().split('\n').slice(1); // skip header
      historyCache = lines.map(line => {
        const [date, value] = line.split(',');
        return { date, value: parseFloat(value) };
      }).filter(p => !isNaN(p.value));
      return historyCache;
    } catch {
      return null;
    }
  }

  function filterByPeriod(history, period) {
    if (!history || history.length === 0) return [];
    const now = new Date();
    const cutoffDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '5Y': 365 * 5 }[period] || 365;
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - cutoffDays);
    return history.filter(p => new Date(p.date) >= cutoff);
  }

  async function renderChart(period) {
    chartHost.innerHTML = '';
    const history = await loadHistory();
    const data = history ? filterByPeriod(history, period).map(p => p.value) : (metric.sparkline_12m || []);
    if (data.length === 0) {
      chartHost.appendChild(el('div', { style: { color: 'var(--ink-3)', fontSize: '12px', fontStyle: 'italic', textAlign: 'center', padding: '40px 0' } },
        history === null ? 'history pending — backfill not yet run for this metric' : `no data in ${period} window`));
      return;
    }
    chartHost.appendChild(renderSparkline({
      data, width: 540, height: 160, fill: true, trend_direction: dir
    }));
    // Show range under chart
    const min = Math.min(...data), max = Math.max(...data);
    chartHost.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '4px' } }, [
      el('span', {}, `min ${min.toFixed(2)}`),
      el('span', {}, `${data.length} pts`),
      el('span', {}, `max ${max.toFixed(2)}`)
    ]));
  }

  // Initial render — defer to next tick so DOM is mounted
  setTimeout(() => renderChart('1Y'), 0);

  // Risk score band (only if 0-100 indexed)
  if (metric.value_format === 'integer' && metric.unit && metric.unit.includes('100')) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Position on band'));
    pad.appendChild(renderBand({ value: metric.value }));
  }

  // Why it matters
  if (metric.why_it_matters) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Why this matters'));
    pad.appendChild(el('p', { class: 'md-paragraph' }, metric.why_it_matters));
  }

  // Formula (derived metrics)
  if (metric.formula) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Formula'));
    pad.appendChild(el('code', { class: 'md-formula' }, metric.formula));
  }

  // Trigger thresholds
  if (metric.trigger_thresholds && metric.trigger_thresholds.length) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Trigger thresholds'));
    pad.appendChild(el('ul', { class: 'md-list' },
      metric.trigger_thresholds.map(t =>
        el('li', {}, [
          el('span', { class: 'pill ' + statusClass(t.level), style: { marginRight: '10px' } }, t.level),
          el('code', { class: 'md-rule' }, t.rule)
        ])
      )
    ));
  }

  // Sources
  pad.appendChild(el('div', { class: 'md-section-head' }, 'Sources'));
  const srcList = el('div', { class: 'md-sources' });
  if (metric.source_primary) {
    srcList.appendChild(srcRow('Primary', metric.source_primary));
  }
  for (const cc of (metric.source_crosscheck || [])) {
    srcList.appendChild(srcRow('Cross-check', cc));
  }
  pad.appendChild(srcList);
  pad.appendChild(el('div', { class: 'md-verification' }, [
    el('span', { class: 'lbl' }, 'Verification'),
    el('span', { class: 'val' }, metric.verification_state || '—'),
    el('span', { class: 'lbl' }, 'Last verified'),
    el('span', { class: 'val' }, formatAsOf(metric.last_verified_at))
  ]));

  // Linked metrics
  if (metric.linked_metrics && metric.linked_metrics.length) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Linked metrics'));
    pad.appendChild(el('div', { class: 'md-chips' },
      metric.linked_metrics.map(id => el('a', {
        class: 'md-chip',
        href: '#metric=' + id,
        onclick: (e) => { e.preventDefault(); open(id); }
      }, id))
    ));
  }

  // Watch next
  if (metric.watch_next && metric.watch_next.length) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Watch next'));
    pad.appendChild(el('ul', { class: 'md-list md-watch' },
      metric.watch_next.map(w => el('li', {}, w))
    ));
  }

  // Notes
  if (metric.notes) {
    pad.appendChild(el('div', { class: 'md-section-head' }, 'Notes'));
    pad.appendChild(el('p', { class: 'md-paragraph md-notes' }, metric.notes));
  }

  _drawer.appendChild(pad);
}

function trendCell(label, value, klass) {
  return el('div', { class: 'md-trend' }, [
    el('span', { class: 'lbl' }, label),
    el('b', { class: klass }, value)
  ]);
}

function srcRow(label, src) {
  return el('div', { class: 'md-source' }, [
    el('span', { class: 'md-source-label' }, label),
    el('a', { class: 'md-source-link', href: src.url, target: '_blank', rel: 'noopener' }, src.name),
    el('span', { class: 'md-source-meta' }, src.type + (src.frequency ? ' · ' + src.frequency : ''))
  ]);
}
