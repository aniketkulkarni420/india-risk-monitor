// Chart builders · Phase 5.5 redesign
// Extends Sparkline. Pure functions returning DOM/SVG. Used by main.mjs section assembly.
// Locked vocabulary (per IRM_DataViz_Audit_v2 §08): bottom legends, no inline label collisions.

import { el, formatValue, formatTrend, formatAsOf, statusClass, rangeTick } from './utils.mjs';
import { renderSparkline } from './Sparkline.mjs';

const SVG_NS ='http://www.w3.org/2000/svg';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) e.setAttribute(k, String(v));
  }
  return e;
}

function statusColor(status) {
  return { low: 'var(--green)', med: 'var(--amber)', high: 'var(--red)', shock: 'var(--red)' }[status] || 'var(--ink-3)';
}

// Title row with optional inline "as on …" stamp on the right.
// Used by every chart helper so as-of is consistently rendered.
function vizTitleEl(title, asof) {
  if (!asof) return el('div', { class: 'viz-title' }, title);
  return el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' } }, [
    el('span', {}, title),
    el('span', { class: 'viz-asof', style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)' } }, asof)
  ]);
}

// ──────────────────────────────────────────────────────────────
// renderDriverBars · used by Hero vital signs + Sector drilldown
// items: [{ label, value, max, status, delta? }]  (sorted by value desc)
// ──────────────────────────────────────────────────────────────
export function renderDriverBars(items, opts = {}) {
  const { showDelta = true, showArrow = false, labelWidth = 130, max = 100, deltaUnit = '' } = opts;
  const rows = items.map(item => {
    const pct = Math.max(0, Math.min(100, (item.value / (item.max || max)) * 100));
    const color = statusColor(item.status);
    const cells = [
      el('span', { class: 'driver-bar-label' }, item.label),
      el('div', { class: 'driver-bar-track' }, [
        el('div', { class: 'driver-bar-fill', style: { width: pct + '%', background: color } })
      ]),
      el('span', { class: 'driver-bar-value', style: { color } }, String(item.value))
    ];
    if (showArrow) {
      // Direction arrow based on delta sign · ↑ red (rising stress) / ↓ green (easing) / → grey (flat)
      let arrow = '→', aColor = 'var(--ink-3)';
      if (item.delta != null && Math.abs(item.delta) >= 1) {
        if (item.delta > 0) { arrow = '↑'; aColor = 'var(--red)'; }
        else { arrow = '↓'; aColor = 'var(--green)'; }
      }
      cells.push(el('span', { class: 'driver-bar-arrow', style: { color: aColor, fontFamily: 'var(--mono)', fontSize: '13px', textAlign: 'center' } }, arrow));
    } else if (showDelta && item.delta != null) {
      const dColor = item.delta > 0 ? color : 'var(--green)';
      cells.push(el('span', { class: 'driver-bar-delta', style: { color: dColor } },
        (item.delta > 0 ? '+' : '') + item.delta + deltaUnit));
    }
    const colWidth = showArrow ? '32px' : (showDelta ? '40px' : '');
    return el('div', {
      class: 'driver-bar-row',
      style: { gridTemplateColumns: `${labelWidth}px 1fr 50px ${colWidth}` }
    }, cells);
  });
  return el('div', { class: 'driver-bars' }, rows);
}

// ──────────────────────────────────────────────────────────────
// renderHorizonCard · Flows 4-card row
// ──────────────────────────────────────────────────────────────
export function renderHorizonCard(label, net, sub, fii, dii, opts = {}) {
  const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--amber)';
  const suf = opts.suffix ? ' ' + opts.suffix : '';
  const fmt = (n) => new Intl.NumberFormat('en-IN').format(Math.round(n));
  return el('div', { class: 'horizon-card' }, [
    el('div', { class: 'hc-label' }, label),
    el('div', { class: 'hc-value', style: { color: netColor } }, (net > 0 ? '+' : '') + fmt(net) + suf),
    el('div', { class: 'hc-sub' }, sub),
    el('div', { class: 'hc-split' }, [
      el('span', { style: { color: 'var(--red)', fontFamily: 'var(--mono)' } }, `FII ${fii > 0 ? '+' : ''}${fmt(fii)}${suf}`),
      el('span', { style: { color: 'var(--green)', fontFamily: 'var(--mono)' } }, `DII ${dii > 0 ? '+' : ''}${fmt(dii)}${suf}`)
    ]),
    opts.asof ? el('div', { class: 'hc-asof', style: { fontSize: '10px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '8px', borderTop: '1px dashed var(--line-2)', paddingTop: '6px' } }, 'as on ' + opts.asof) : null
  ].filter(Boolean));
}

// ──────────────────────────────────────────────────────────────
// renderRegimeBanner · Flows lens 1
// ──────────────────────────────────────────────────────────────
export function renderRegimeBanner({ regime, description, hint, status, persistence, glossary, asof }) {
  return el('div', { class: 'regime-banner' }, [
    el('div', { class: 'rb-label' }, [
      regime,
      glossary ? el('span', { title: glossary, style: { marginLeft: '6px', cursor: 'help', color: 'var(--ink-3)', fontSize: '11px', border: '1px solid var(--line-2)', borderRadius: '50%', width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', fontFamily: 'var(--mono)' } }, '?') : null
    ].filter(Boolean)),
    el('div', { class: 'rb-body' }, [
      el('div', { class: 'rb-desc' }, description),
      el('div', { class: 'rb-hint' }, hint),
      asof ? el('div', { style: { fontSize: '10px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '6px' } }, 'as on ' + asof) : null
    ].filter(Boolean)),
    el('div', { class: 'rb-status' }, [
      el('span', { class: 'pill ' + statusClass(status) }, persistence ? `STABLE · ${persistence} sess` : status.toUpperCase())
    ])
  ]);
}

// ──────────────────────────────────────────────────────────────
// renderPersistenceChips · Flows lens 3
// chips: [{ label, value, color }]
// ──────────────────────────────────────────────────────────────
export function renderPersistenceChips(chips) {
  return el('div', { class: 'persistence-row' }, chips.map(c =>
    el('div', { class: 'persistence-chip' }, [
      el('div', { class: 'pc-label' }, c.label),
      el('div', { class: 'pc-value', style: { color: c.color || 'var(--ink)' } }, c.value)
    ])
  ));
}

// ──────────────────────────────────────────────────────────────
// renderCumulativeLine · 2-series cumulative chart with bottom legend
// series: [{ name, color, points: [{ label, value }], current }]
// ──────────────────────────────────────────────────────────────
export function renderCumulativeLine(series, opts = {}) {
  const { width = 600, height = 200, padTop = 20, padBottom = 30, padLeft = 50, padRight = 20, title } = opts;
  // Guard · if every series has <4 unique values, the chart will render a flat
  // line that fakes a trend. Show "history accruing" placeholder instead.
  const allThin = series.every(s => {
    const pts = (s.points || []).map(p => p.value).filter(v => typeof v === 'number');
    return new Set(pts).size < 4;
  });
  if (allThin) {
    const wrap = el('div', { class: 'cl-thin' }, [
      title ? el('div', { class: 'cl-title' }, title) : null,
      el('div', { class: 'cl-thin-msg' }, [
        el('div', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, 'history accruing'),
        el('div', { style: { fontSize: '10.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '4px' } },
          'Need ≥4 unique values to render trend · ' + series.map(s => s.name + ': ' + (s.current || '—')).join(' · ')),
        opts.summary ? el('div', { style: { fontSize: '11px', color: 'var(--ink-3)', marginTop: '6px' } }, opts.summary) : null
      ].filter(Boolean))
    ].filter(Boolean));
    return wrap;
  }
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  // Determine y range across all series
  const allValues = series.flatMap(s => s.points.map(p => p.value));
  const minY = Math.min(0, ...allValues);
  const maxY = Math.max(0, ...allValues);
  const rangeY = maxY - minY || 1;
  const yScale = (v) => padTop + (1 - (v - minY) / rangeY) * innerH;
  const xScale = (i, n) => padLeft + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });

  // Zero baseline
  const zeroY = yScale(0);
  svg.appendChild(svgEl('line', { x1: padLeft, y1: zeroY, x2: width - padRight, y2: zeroY, stroke: 'var(--line-2)', 'stroke-dasharray': '2,3' }));
  const zeroLabel = svgEl('text', { x: padLeft - 6, y: zeroY + 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'end' });
  zeroLabel.textContent = '0'; svg.appendChild(zeroLabel);

  // Series lines
  for (const s of series) {
    const pts = s.points.map((p, i) => `${xScale(i, s.points.length)},${yScale(p.value)}`).join(' ');
    svg.appendChild(svgEl('polyline', { fill: 'none', stroke: s.color, 'stroke-width': 2.2, points: pts }));
    const last = s.points[s.points.length - 1];
    svg.appendChild(svgEl('circle', { cx: xScale(s.points.length - 1, s.points.length), cy: yScale(last.value), r: 4, fill: s.color }));
  }

  // X axis labels (use first series points)
  if (series.length > 0) {
    const labels = series[0].points;
    const xLabelEvery = Math.max(1, Math.floor(labels.length / 4));
    for (let i = 0; i < labels.length; i += xLabelEvery) {
      const t = svgEl('text', { x: xScale(i, labels.length), y: height - 8, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'middle' });
      t.textContent = labels[i].label; svg.appendChild(t);
    }
  }

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(svg);

  // Legend
  const legend = el('div', { class: 'viz-legend-row' });
  for (const s of series) {
    legend.appendChild(el('span', { class: 'viz-legend-item' }, [
      el('span', { class: 'viz-swatch', style: { background: s.color } }),
      `${s.name} · `,
      el('b', { style: { color: s.color, fontFamily: 'var(--mono)' } }, s.current || '')
    ]));
  }
  if (opts.summary) {
    legend.appendChild(el('span', { style: { marginLeft: 'auto', color: 'var(--ink-2)' } }, opts.summary));
  }
  wrap.appendChild(legend);
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderDivergingBars · Sectoral rotation
// data: { sells: [{ name, value }], buys: [{ name, value }] }
// ──────────────────────────────────────────────────────────────
export function renderDivergingBars({ sells = [], buys = [] }, opts = {}) {
  const { title } = opts;
  const allMagnitudes = [...sells, ...buys].map(d => Math.abs(d.value));
  const max = Math.max(...allMagnitudes, 1);

  const sellRows = sells.map(s => el('div', { class: 'div-bar-row' }, [
    el('span', { class: 'db-name' }, s.name),
    el('div', { class: 'db-track' }, [
      el('div', { class: 'db-fill', style: { width: (Math.abs(s.value) / max * 100) + '%', background: 'var(--red)' } })
    ]),
    el('span', { class: 'db-value', style: { color: 'var(--red)' } }, formatValue(s.value, 'currency_inr_cr'))
  ]));
  const buyRows = buys.map(b => el('div', { class: 'div-bar-row' }, [
    el('span', { class: 'db-name' }, b.name),
    el('div', { class: 'db-track' }, [
      el('div', { class: 'db-fill', style: { width: (Math.abs(b.value) / max * 100) + '%', background: 'var(--green)' } })
    ]),
    el('span', { class: 'db-value', style: { color: 'var(--green)' } }, '+' + formatValue(b.value, 'currency_inr_cr'))
  ]));

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(el('div', { class: 'div-bars-grid' }, [
    el('div', {}, [
      el('div', { class: 'div-bars-head sell' }, 'SELLING'),
      el('div', { class: 'div-bars-list' }, sellRows)
    ]),
    el('div', {}, [
      el('div', { class: 'div-bars-head buy' }, 'BUYING'),
      el('div', { class: 'div-bars-list' }, buyRows)
    ])
  ]));
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderYieldCurve · Macro panel 1
// today/lastWeek: [{ tenor: '1Y'|'5Y'|'10Y', value: number }]
// ──────────────────────────────────────────────────────────────
export function renderYieldCurve(today, lastWeek, opts = {}) {
  const { width = 480, height = 200, title = 'G-sec curve · today vs last week', asof } = opts;
  const padTop = 50, padBottom = 30, padLeft = 60, padRight = 40;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const allValues = [...today, ...lastWeek].map(p => p.value);
  const minY = Math.min(...allValues) - 0.2;
  const maxY = Math.max(...allValues) + 0.2;
  const rangeY = maxY - minY || 1;
  const yScale = (v) => padTop + (1 - (v - minY) / rangeY) * innerH;
  const xScale = (i, n) => padLeft + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });

  // Y grid (3 lines)
  for (let f = 0; f <= 2; f++) {
    const v = minY + (f / 2) * (maxY - minY);
    const y = yScale(v);
    svg.appendChild(svgEl('line', { x1: padLeft, y1: y, x2: width - padRight, y2: y, stroke: 'var(--line-2)', 'stroke-dasharray': '2,3', opacity: f === 0 || f === 2 ? 0.6 : 0.3 }));
    const t = svgEl('text', { x: padLeft - 6, y: y + 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'end' });
    t.textContent = v.toFixed(2); svg.appendChild(t);
  }

  // Last week (faded)
  if (lastWeek && lastWeek.length) {
    const pts = lastWeek.map((p, i) => `${xScale(i, lastWeek.length)},${yScale(p.value)}`).join(' ');
    svg.appendChild(svgEl('polyline', { fill: 'none', stroke: '#3a4252', 'stroke-width': 1.8, 'stroke-dasharray': '3,4', points: pts }));
    lastWeek.forEach((p, i) => svg.appendChild(svgEl('circle', { cx: xScale(i, lastWeek.length), cy: yScale(p.value), r: 3, fill: '#3a4252' })));
  }
  // Today (gold)
  const tPts = today.map((p, i) => `${xScale(i, today.length)},${yScale(p.value)}`).join(' ');
  svg.appendChild(svgEl('polyline', { fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.4, points: tPts }));
  today.forEach((p, i) => {
    const x = xScale(i, today.length);
    const y = yScale(p.value);
    svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 5, fill: 'var(--accent)' }));
    const lbl = svgEl('text', { x, y: y - 14, fill: 'var(--accent)', 'font-family': 'JetBrains Mono', 'font-size': 11, 'text-anchor': 'middle', 'font-weight': 600 });
    lbl.textContent = p.value.toFixed(2); svg.appendChild(lbl);
    const xLbl = svgEl('text', { x, y: height - 8, fill: 'var(--ink-2)', 'font-family': 'Manrope', 'font-size': 11, 'text-anchor': 'middle' });
    xLbl.textContent = p.tenor; svg.appendChild(xLbl);
  });

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(svg);

  const slope = today[today.length - 1].value - today[0].value;
  const lastSlope = lastWeek?.length ? lastWeek[lastWeek.length - 1].value - lastWeek[0].value : null;
  const slopeChange = lastSlope != null ? (slope - lastSlope) * 100 : null;
  const legend = el('div', { class: 'viz-legend-row' }, [
    el('span', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: { background: 'var(--accent)' } }), 'Today']),
    el('span', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: { background: '#3a4252' } }), 'Last week']),
    slopeChange != null ? el('span', { style: { marginLeft: 'auto', color: 'var(--ink-2)' } }, [
      'Slope ', el('b', { style: { color: 'var(--ink)', fontFamily: 'var(--mono)' } }, `${(slope * 100).toFixed(0)} bps`),
      ` · ${slopeChange > 0 ? 'steepened' : 'flattened'} ${Math.abs(slopeChange).toFixed(0)} bps w/w`
    ]) : null
  ].filter(Boolean));
  wrap.appendChild(legend);
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderInflationBars · Macro panel 2
// items: [{ label, value }]; target: number
// ──────────────────────────────────────────────────────────────
export function renderInflationBars(items, target, opts = {}) {
  const { width = 360, height = 200, title = 'Inflation · % YoY', asof } = opts;
  const padTop = 40, padBottom = 40, padLeft = 40, padRight = 20;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const maxV = Math.max(...items.map(i => i.value), target + 1) + 1;
  const yScale = (v) => padTop + (1 - v / maxV) * innerH;
  const barW = (innerW / items.length) * 0.5;
  const slotW = innerW / items.length;

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });

  // Baseline
  svg.appendChild(svgEl('line', { x1: padLeft, y1: padTop + innerH, x2: width - padRight, y2: padTop + innerH, stroke: 'var(--line-2)' }));

  // Y ticks every 2%
  for (let v = 2; v <= maxV; v += 2) {
    const y = yScale(v);
    const t = svgEl('text', { x: padLeft - 6, y: y + 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'end' });
    t.textContent = v + '%'; svg.appendChild(t);
  }

  // Target line (no inline text — goes in legend)
  const targetY = yScale(target);
  svg.appendChild(svgEl('line', { x1: padLeft, y1: targetY, x2: width - padRight, y2: targetY, stroke: 'var(--accent)', 'stroke-dasharray': '3,4', 'stroke-width': 1.5 }));

  // Bars + value labels
  // Value labels sit above the bar by default. If they would collide with the
  // dashed target line, render them inside the bar (below bar top) so the
  // dashed line never cuts through a number.
  const COLLIDE_PX = 12;
  items.forEach((item, i) => {
    const x = padLeft + i * slotW + (slotW - barW) / 2;
    const y = yScale(item.value);
    const h = padTop + innerH - y;
    const fillColor = item.value > target ? 'var(--red)' : 'var(--green)';
    svg.appendChild(svgEl('rect', { x, y, width: barW, height: h, fill: fillColor, opacity: 0.85 }));

    // Decide label position based on dashed-target proximity.
    let labelY = y - 8;            // default: above bar
    let labelFill = fillColor;
    let labelInside = false;
    if (Math.abs(labelY - targetY) < COLLIDE_PX) {
      // Collision: place label inside the bar, top edge, in white-ish
      labelY = y + 14;
      labelFill = '#0a0d12';       // dark bg colour reads on a coloured bar
      labelInside = true;
      // Only render inside the bar if the bar is tall enough; otherwise fall back below the dashed line
      if (h < 22) {
        labelY = targetY + 16;
        labelFill = fillColor;
        labelInside = false;
      }
    }
    const valLabel = svgEl('text', {
      x: x + barW / 2, y: labelY,
      fill: labelFill,
      'font-family': 'JetBrains Mono', 'font-size': 11,
      'text-anchor': 'middle', 'font-weight': 700
    });
    valLabel.textContent = item.value.toFixed(2);
    svg.appendChild(valLabel);

    const xLbl = svgEl('text', { x: x + barW / 2, y: height - 12, fill: 'var(--ink-2)', 'font-family': 'Manrope', 'font-size': 11, 'text-anchor': 'middle' });
    xLbl.textContent = item.label; svg.appendChild(xLbl);
  });

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(svg);
  wrap.appendChild(el('div', { class: 'viz-legend-row' }, [
    el('span', { class: 'viz-legend-item' }, [
      el('span', { class: 'viz-swatch', style: { background: 'var(--accent)', opacity: 0.7, height: 2 } }),
      `RBI ${target}% target`
    ]),
    opts.note ? el('span', { style: { marginLeft: 'auto', color: 'var(--ink-2)' } }, opts.note) : null
  ].filter(Boolean)));
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderCurrencyStrip · Macro panel 3
// items: [{ label, value, unit, sparkline, mom_pct, yoy_pct, trend_direction }]
// ──────────────────────────────────────────────────────────────
export function renderCurrencyStrip(items) {
  return el('div', { class: 'currency-strip' }, items.map(item => {
    const dir = item.trend_direction || 'neutral';
    return el('div', { class: 'cs-cell', title: item.tooltip || '' }, [
      el('div', { class: 'cs-label' }, item.label),
      el('div', { class: 'cs-value' }, item.value),
      item.asof ? el('div', { style: { fontSize: '10px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '2px' } }, 'as on ' + item.asof) : null,
      el('div', { class: 'cs-spark' }, [renderSparkline({
        data: item.sparkline, width: 120, height: 32, fill: false, trend_direction: dir
      })]),
      el('div', { class: 'cs-trends' }, [
        item.mom_pct != null ? el('span', {}, [
          'MoM ', el('b', { style: { color: (item.mom_pct > 0 && dir === 'bad') || (item.mom_pct < 0 && dir === 'good') ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, formatTrend(item.mom_pct))
        ]) : null,
        item.yoy_pct != null ? el('span', {}, [
          'YoY ', el('b', { style: { color: (item.yoy_pct > 0 && dir === 'bad') || (item.yoy_pct < 0 && dir === 'good') ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, formatTrend(item.yoy_pct))
        ]) : null
      ].filter(Boolean)),
      item.range ? renderRangeTick(item.range, { compact: true }) : null
    ].filter(Boolean));
  }));
}

// ──────────────────────────────────────────────────────────────
// renderTimelineStrip · 5C · 30-day event timeline above section header
// events = [{ date: ISO, severity: 'low'|'med'|'high'|'shock'|'now', label, metricId? }]
// Renders horizontally with dots positioned by date · click → optional handler
// opts: { onClick, days = 30, compact }
// ──────────────────────────────────────────────────────────────
export function renderTimelineStrip(events, opts = {}) {
  if (!events || !events.length) return null;
  const days = opts.days || 30;
  const now = Date.now();
  const start = now - days * 24 * 3600 * 1000;
  // Always include "NOW" marker at the right edge
  const items = events.filter(e => {
    const t = new Date(e.date).getTime();
    return t >= start && t <= now;
  });
  items.push({ date: new Date(now).toISOString(), severity: 'now', label: 'NOW' });

  return el('div', { class: 'timeline-strip' + (opts.compact ? ' compact' : '') }, [
    el('span', { class: 'timeline-strip-label' }, '30d events'),
    el('div', { class: 'timeline-strip-rail' },
      items.map(ev => {
        const t = new Date(ev.date).getTime();
        const pct = Math.max(0, Math.min(100, ((t - start) / (now - start)) * 100));
        const sev = ev.severity || 'med';
        const dotCls = 'timeline-strip-dot timeline-strip-dot-' + sev;
        const isNow = sev === 'now';
        return el('div', {
          class: 'timeline-strip-ev' + (isNow ? ' is-now' : ''),
          style: { left: pct + '%' },
          title: ev.label + ' · ' + ev.date.split('T')[0],
          onclick: () => { if (opts.onClick && !isNow) opts.onClick(ev); }
        }, [
          el('span', { class: dotCls }),
          el('span', { class: 'timeline-strip-label' + (isNow ? ' is-now' : '') }, isNow ? 'NOW' : ev.label)
        ]);
      })
    )
  ]);
}

// ──────────────────────────────────────────────────────────────
// renderLensRow · V60 Flows · 4-lens regime strip
// lenses = [{ label, value, pill: {text, klass}, read }]
// ──────────────────────────────────────────────────────────────
export function renderLensRow(lenses) {
  return el('div', { class: 'lens-row' }, lenses.map(l => el('div', { class: 'lens-cell' }, [
    el('div', { class: 'lens-head' }, [
      el('span', { class: 'lens-name' }, l.label),
      l.pill ? el('span', { class: 'lens-pill ' + (l.pill.klass || '') }, l.pill.text) : null
    ].filter(Boolean)),
    el('div', { class: 'lens-value ' + (l.valueClass || '') }, l.value),
    l.read ? el('div', { class: 'lens-read' }, l.read) : null
  ].filter(Boolean))));
}

// renderCardsAsTabs · V60 Flows · period selector with headline net in each tab
// items = [{ id, label, net, sub, active }]
// onChange(id) called on click
export function renderCardsAsTabs(items, onChange) {
  return el('div', { class: 'cat-strip', role: 'tablist' }, items.map(item =>
    el('button', {
      class: 'cat-tab' + (item.active ? ' active' : ''),
      role: 'tab',
      'aria-selected': item.active ? 'true' : 'false',
      'data-tab-id': item.id,
      onclick: () => onChange && onChange(item.id)
    }, [
      el('div', { class: 'ct-label' }, item.label),
      el('div', { class: 'ct-net ' + (item.netClass || '') }, item.net),
      item.sub ? el('div', { class: 'ct-sub' }, item.sub) : null
    ].filter(Boolean))
  ));
}

// renderFlowsFocused · V60 Flows · 3-cell value grid + bar trio + narrative
// data = { period_label, period_sub, fii, dii, net, narrative, asof, absorption }
// fii/dii/net = { value: raw number, formatted: string }
export function renderFlowsFocused(data) {
  const max = Math.max(Math.abs(data.fii.value), Math.abs(data.dii.value), Math.abs(data.net.value));
  const pct = (v) => max ? Math.round(Math.abs(v) / max * 100) : 0;
  return el('div', { class: 'flows-focused' }, [
    el('div', { class: 'flows-focused-head' }, [
      el('div', { class: 'ff-title' }, data.period_label),
      data.period_sub ? el('div', { class: 'ff-meta' }, data.period_sub) : null
    ].filter(Boolean)),
    // 3-cell grid
    el('div', { class: 'flow-grid' }, [
      el('div', { class: 'flow-cell' }, [
        el('div', { class: 'flow-cell-label' }, 'FII equity'),
        el('div', { class: 'flow-cell-value neg' }, data.fii.formatted),
        data.fii.sub ? el('div', { class: 'flow-cell-sub' }, data.fii.sub) : null
      ].filter(Boolean)),
      el('div', { class: 'flow-cell' }, [
        el('div', { class: 'flow-cell-label' }, 'DII equity'),
        el('div', { class: 'flow-cell-value pos' }, data.dii.formatted),
        data.dii.sub ? el('div', { class: 'flow-cell-sub' }, data.dii.sub) : null
      ].filter(Boolean)),
      el('div', { class: 'flow-cell' }, [
        el('div', { class: 'flow-cell-label' }, 'Net'),
        el('div', { class: 'flow-cell-value ' + (data.net.value >= 0 ? 'pos' : 'neg') }, data.net.formatted),
        data.net.sub ? el('div', { class: 'flow-cell-sub' }, data.net.sub) : null
      ].filter(Boolean))
    ]),
    // ★ Bar trio with magnitude band shaded zones BEHIND the track
    // Zones are computed relative to the largest bar (max) and the absolute thresholds
    // ±2k normal · ±5k notable · ±15k stress. Renders as 3 background tints.
    (() => {
      const pct2k  = max ? Math.min(100, (2000  / max) * 100) : 13;
      const pct5k  = max ? Math.min(100, (5000  / max) * 100) : 33;
      const pct15k = max ? Math.min(100, (15000 / max) * 100) : 100;
      const trackBg = `linear-gradient(90deg,
        rgba(127,201,154,.08) 0%, rgba(127,201,154,.08) ${pct2k}%,
        rgba(233,196,102,.08) ${pct2k}%, rgba(233,196,102,.08) ${pct5k}%,
        rgba(232,136,136,.10) ${pct5k}%, rgba(232,136,136,.10) ${pct15k}%,
        rgba(232,136,136,.20) ${pct15k}%, rgba(232,136,136,.20) 100%)`;
      return el('div', { class: 'bar-trio' }, [
        el('div', { class: 'bar-row' }, [
          el('span', { class: 'bar-label' }, 'FII'),
          el('div', { class: 'bar-track', style: { background: trackBg } }, [
            el('div', { class: 'bar-fill bf-red', style: { width: pct(data.fii.value) + '%' } })
          ]),
          el('span', { class: 'bar-num neg' }, formatNumberShort(data.fii.value))
        ]),
        el('div', { class: 'bar-row' }, [
          el('span', { class: 'bar-label' }, 'DII'),
          el('div', { class: 'bar-track', style: { background: trackBg } }, [
            el('div', { class: 'bar-fill bf-green', style: { width: pct(data.dii.value) + '%' } })
          ]),
          el('span', { class: 'bar-num pos' }, formatNumberShort(data.dii.value))
        ]),
        el('div', { class: 'bar-row' }, [
          el('span', { class: 'bar-label' }, 'Net'),
          el('div', { class: 'bar-track', style: { background: trackBg } }, [
            el('div', { class: 'bar-fill ' + (data.net.value >= 0 ? 'bf-green' : 'bf-red'), style: { width: pct(data.net.value) + '%' } })
          ]),
          el('span', { class: 'bar-num ' + (data.net.value >= 0 ? 'pos' : 'neg') }, formatNumberShort(data.net.value))
        ])
      ]);
    })(),
    // Band legend · tiny tick labels under the bar trio
    el('div', { class: 'flow-bands' }, [
      el('span', { class: 'flow-band-tick flow-band-normal' }, '±2k normal'),
      el('span', { class: 'flow-band-tick flow-band-notable' }, '±5k notable'),
      el('span', { class: 'flow-band-tick flow-band-stress' }, '±15k stress')
    ]),
    // Absorption gauge (0 → 1.5× scale)
    data.absorption != null ? renderAbsorptionGauge(data.absorption) : null,
    // Narrative
    data.narrative ? el('div', { class: 'flow-narrative' }, [el('b', {}, data.narrative_lead || ''), ' ', data.narrative]) : null
  ].filter(Boolean));
}

function formatNumberShort(v) {
  if (v == null) return '—';
  const sign = v < 0 ? '−' : '+';
  const a = Math.abs(v);
  return sign + Math.round(a).toLocaleString('en-IN');
}

export function renderAbsorptionGauge(ratio) {
  // Clamp to 0–1.5× for display
  const v = Math.max(0, Math.min(1.5, ratio));
  const pct = (v / 1.5) * 100;
  return el('div', { class: 'absorb-gauge-wrap' }, [
    el('div', { class: 'absorb-gauge-label' }, 'Absorption ratio · ' + ratio.toFixed(2) + '×'),
    el('div', { class: 'absorb-gauge' }, [
      el('div', { class: 'absorb-gauge-marker', style: { left: pct + '%' } })
    ]),
    el('div', { class: 'absorb-gauge-row' }, [
      el('span', {}, '0×'), el('span', {}, '0.5×'), el('span', {}, '1.0× full'), el('span', {}, '1.5×')
    ])
  ]);
}

// F&O OI 5-session persistence bar
// sessions = array of numbers (last 5 values · negative = unwinding · positive = building)
export function renderPersistenceBar(sessions) {
  if (!sessions || !sessions.length) return null;
  const last5 = sessions.slice(-5);
  return el('div', { class: 'persistence-bar-wrap' }, [
    el('div', { class: 'persistence-bar-label' }, 'F&O OI · last 5 sessions'),
    el('div', { class: 'persistence-bar' }, last5.map(v => {
      const cls = v > 0 ? 'pb-pos' : v < 0 ? 'pb-neg' : 'pb-flat';
      const op = v === 0 ? 0.3 : Math.min(1, 0.4 + Math.abs(v) / 20);
      return el('span', { class: 'persistence-bar-cell ' + cls, style: { opacity: op } });
    }))
  ]);
}

// ──────────────────────────────────────────────────────────────
// renderRangeTick · 3A · 12m range bar + marker + qualitative label
// info comes from utils.rangeTick(metric): { positionPct, label, lo, hi }
// opts: { compact: bool — hides lo/hi labels under the bar }
// ──────────────────────────────────────────────────────────────
export function renderRangeTick(info, opts = {}) {
  if (!info) return null;
  const { positionPct, label, lo, hi } = info;
  const fmt = (v) => Math.abs(v) >= 1000 ? v.toFixed(0)
                  : Math.abs(v) >= 10   ? v.toFixed(1)
                  : v.toFixed(2);
  return el('div', { class: 'range-tick' }, [
    el('div', { class: 'range-tick-label' }, label),
    el('div', { class: 'range-tick-bar' }, [
      el('div', { class: 'range-tick-fill', style: { width: positionPct + '%' } }),
      el('div', { class: 'range-tick-marker', style: { left: 'calc(' + positionPct + '% - 1px)' } })
    ]),
    opts.compact ? null : el('div', { class: 'range-tick-row' }, [
      el('span', {}, fmt(lo) + ' (12m low)'),
      el('span', {}, fmt(hi) + ' (12m high)')
    ])
  ].filter(Boolean));
}

// ──────────────────────────────────────────────────────────────
// renderProgressBar · Macro fiscal · single bar with target marker
// ──────────────────────────────────────────────────────────────
export function renderProgressBar(label, pctValue, opts = {}) {
  const { showTarget = true, target = 100, color = 'var(--green)' } = opts;
  return el('div', { class: 'progress-bar' }, [
    el('div', { class: 'pb-head' }, [
      el('span', { class: 'pb-label' }, label),
      el('span', { class: 'pb-value', style: { color } }, pctValue.toFixed(1) + '%')
    ]),
    el('div', { class: 'pb-track' }, [
      el('div', { class: 'pb-fill', style: { width: pctValue + '%', background: color } }),
      showTarget ? el('div', { class: 'pb-target', style: { left: target + '%' } }) : null
    ].filter(Boolean))
  ]);
}

// ──────────────────────────────────────────────────────────────
// renderGaugeRow · Macro panel 5 · 3 leading indicators with above/below threshold marker
// items: [{ label, value, unit, threshold, betterAbove, formatter }]
// ──────────────────────────────────────────────────────────────
export function renderGaugeRow(items) {
  return el('div', { class: 'gauge-row' }, items.map(item => {
    const ratio = Math.max(0, Math.min(1, item.value / (item.maxScale || item.threshold * 2)));
    const color = item.betterAbove
      ? (item.value >= item.threshold ? 'var(--green)' : 'var(--red)')
      : (item.value <= item.threshold ? 'var(--green)' : 'var(--red)');
    const formatter = item.formatter || ((v) => (v > 0 ? '+' : '') + v.toFixed(2) + (item.unit || ''));
    const thresholdPct = (item.threshold / (item.maxScale || item.threshold * 2)) * 100;
    return el('div', { class: 'gauge-cell' }, [
      el('div', { class: 'gauge-label' }, item.label),
      el('div', { class: 'gauge-value', style: { color } }, formatter(item.value)),
      el('div', { class: 'gauge-track' }, [
        el('div', { class: 'gauge-fill', style: { width: (ratio * 100) + '%', background: color } }),
        el('div', { class: 'gauge-threshold', style: { left: thresholdPct + '%' } })
      ]),
      el('div', { class: 'gauge-hint' }, item.hint)
    ]);
  }));
}

// ──────────────────────────────────────────────────────────────
// renderPairedLine · Brent + India crude (or any 2-series line)
// series: [{ name, color, points: [{ label, value }], current: 'string' }]
// ──────────────────────────────────────────────────────────────
export function renderPairedLine(series, opts = {}) {
  const { width = 600, height = 220, title, thresholdLine = null, summary } = opts;
  const padTop = 30, padBottom = 30, padLeft = 50, padRight = 70;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const allValues = series.flatMap(s => s.points.map(p => p.value));
  const minY = Math.min(...allValues) - 2;
  const maxY = Math.max(...allValues) + 2;
  const rangeY = maxY - minY || 1;
  const yScale = (v) => padTop + (1 - (v - minY) / rangeY) * innerH;
  const xScale = (i, n) => padLeft + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });

  // Y grid
  for (let f = 0; f <= 3; f++) {
    const v = minY + (f / 3) * (maxY - minY);
    const y = yScale(v);
    svg.appendChild(svgEl('line', { x1: padLeft, y1: y, x2: width - padRight, y2: y, stroke: 'var(--line-2)', 'stroke-dasharray': '2,3', opacity: 0.4 }));
    const t = svgEl('text', { x: padLeft - 6, y: y + 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'end' });
    t.textContent = '$' + Math.round(v); svg.appendChild(t);
  }

  // Optional threshold line
  if (thresholdLine != null) {
    const ty = yScale(thresholdLine);
    svg.appendChild(svgEl('line', { x1: padLeft, y1: ty, x2: width - padRight, y2: ty, stroke: 'var(--red)', 'stroke-dasharray': '3,4', opacity: 0.5 }));
  }

  // Series lines
  for (const s of series) {
    const pts = s.points.map((p, i) => `${xScale(i, s.points.length)},${yScale(p.value)}`).join(' ');
    svg.appendChild(svgEl('polyline', { fill: 'none', stroke: s.color, 'stroke-width': 2.2, points: pts }));
    const last = s.points[s.points.length - 1];
    const lx = xScale(s.points.length - 1, s.points.length);
    const ly = yScale(last.value);
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 4, fill: s.color }));
    // Endpoint label to right
    const elabel = svgEl('text', { x: lx + 8, y: ly + 4, fill: s.color, 'font-family': 'JetBrains Mono', 'font-size': 11, 'font-weight': 600 });
    elabel.textContent = s.current; svg.appendChild(elabel);
  }

  // X axis labels
  if (series.length > 0) {
    const labels = series[0].points;
    const xLabelEvery = Math.max(1, Math.floor(labels.length / 4));
    for (let i = 0; i < labels.length; i += xLabelEvery) {
      const t = svgEl('text', { x: xScale(i, labels.length), y: height - 8, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'middle' });
      t.textContent = labels[i].label; svg.appendChild(t);
    }
  }

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(svg);
  const legend = el('div', { class: 'viz-legend-row' });
  for (const s of series) {
    legend.appendChild(el('span', { class: 'viz-legend-item' }, [
      el('span', { class: 'viz-swatch', style: { background: s.color } }),
      s.name
    ]));
  }
  if (summary) legend.appendChild(el('span', { style: { marginLeft: 'auto', color: 'var(--ink-2)' } }, summary));
  wrap.appendChild(legend);
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderSmallMultiples · Auto block + 3-up freight
// items: [{ label, value, valueFormatted, deltaPct, color }]
// ──────────────────────────────────────────────────────────────
export function renderSmallMultiples(items, opts = {}) {
  const { showBars = true, title } = opts;
  const maxAbs = Math.max(...items.map(i => Math.abs(i.deltaPct || 0)), 1);
  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(el('div', { class: 'small-multiples-grid', style: { gridTemplateColumns: `repeat(${items.length}, 1fr)` } },
    items.map(item => {
      const cells = [
        el('div', { class: 'sm-delta', style: { color: item.color } },
          (item.deltaPct > 0 ? '+' : '') + (item.deltaPct?.toFixed(1) || '0.0') + '%')
      ];
      if (showBars) {
        const heightPct = (Math.abs(item.deltaPct || 0) / maxAbs) * 100;
        cells.push(el('div', { class: 'sm-bar-wrap' }, [
          el('div', { class: 'sm-bar', style: { height: heightPct + '%', background: item.color } })
        ]));
      }
      cells.push(el('div', { class: 'sm-label' }, item.label));
      if (item.valueFormatted) cells.push(el('div', { class: 'sm-units' }, item.valueFormatted));
      if (item.asof) cells.push(el('div', { style: { fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '4px' } }, 'as on ' + item.asof));
      return el('div', { class: 'sm-cell', title: item.tooltip || '' }, cells);
    })
  ));
  if (opts.summary) wrap.appendChild(el('div', { class: 'viz-legend-row' }, [
    el('span', { style: { color: 'var(--ink-2)' } }, opts.summary)
  ]));
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderIndexedOverlay · Movement cluster, equity overlay
// series: [{ name, color, points: [{ label, value }] }]; allIndexed to 100
// ──────────────────────────────────────────────────────────────
export function renderIndexedOverlay(series, opts = {}) {
  const { width = 600, height = 200, title } = opts;
  const padTop = 20, padBottom = 30, padLeft = 50, padRight = 80;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  // Index every series to 100 at first point
  const indexed = series.map(s => ({
    ...s, points: s.points.map(p => ({ label: p.label, value: (p.value / s.points[0].value) * 100 }))
  }));
  const allValues = indexed.flatMap(s => s.points.map(p => p.value));
  const minY = Math.min(...allValues) - 5;
  const maxY = Math.max(...allValues) + 5;
  const yScale = (v) => padTop + (1 - (v - minY) / (maxY - minY)) * innerH;
  const xScale = (i, n) => padLeft + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);

  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });

  // 100 baseline
  const baselineY = yScale(100);
  svg.appendChild(svgEl('line', { x1: padLeft, y1: baselineY, x2: width - padRight, y2: baselineY, stroke: 'var(--line-2)', 'stroke-dasharray': '2,3' }));
  const baseLabel = svgEl('text', { x: padLeft - 6, y: baselineY + 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'end' });
  baseLabel.textContent = '100'; svg.appendChild(baseLabel);

  // Series
  for (const s of indexed) {
    const pts = s.points.map((p, i) => `${xScale(i, s.points.length)},${yScale(p.value)}`).join(' ');
    svg.appendChild(svgEl('polyline', { fill: 'none', stroke: s.color, 'stroke-width': 1.8, points: pts }));
    const last = s.points[s.points.length - 1];
    const lx = xScale(s.points.length - 1, s.points.length);
    const ly = yScale(last.value);
    svg.appendChild(svgEl('circle', { cx: lx, cy: ly, r: 3, fill: s.color }));
  }

  // X axis
  if (indexed.length > 0) {
    const labels = indexed[0].points;
    const xLabelEvery = Math.max(1, Math.floor(labels.length / 4));
    for (let i = 0; i < labels.length; i += xLabelEvery) {
      const t = svgEl('text', { x: xScale(i, labels.length), y: height - 8, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'middle' });
      t.textContent = labels[i].label; svg.appendChild(t);
    }
  }

  const wrap = el('div', { class: 'viz-wrap' });
  if (title) wrap.appendChild(vizTitleEl(title, opts.asof));
  wrap.appendChild(svg);
  const legend = el('div', { class: 'viz-legend-row' });
  for (const s of indexed) {
    const last = s.points[s.points.length - 1].value;
    const change = (last - 100).toFixed(1);
    legend.appendChild(el('span', { class: 'viz-legend-item' }, [
      el('span', { class: 'viz-swatch', style: { background: s.color } }),
      s.name + ' ',
      el('b', { style: { color: s.color, fontFamily: 'var(--mono)' } }, (change > 0 ? '+' : '') + change)
    ]));
  }
  wrap.appendChild(legend);
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderValuationBand · Nifty PE vs 5Y avg
// ──────────────────────────────────────────────────────────────
export function renderValuationBand({ value, min, sigmaMinus, mean, sigmaPlus, max, label = 'NIFTY PE TRAILING', asof }) {
  const range = max - min || 1;
  const pct = (v) => ((v - min) / range) * 100;
  return el('div', { class: 'valuation-band' }, [
    el('div', { class: 'vb-head' }, [
      el('span', { class: 'vb-label' }, label),
      el('span', { class: 'vb-value' }, value.toFixed(1) + '×'),
      el('span', { class: 'vb-status' }, value > sigmaPlus ? 'stretched' : value > mean ? 'above mean' : 'fair')
    ]),
    el('div', { class: 'vb-track' }, [
      // Outer (min-max)
      el('div', { class: 'vb-outer' }),
      // Inner ±1σ
      el('div', { class: 'vb-inner', style: { left: pct(sigmaMinus) + '%', right: (100 - pct(sigmaPlus)) + '%' } }),
      // Mean tick
      el('div', { class: 'vb-mean', style: { left: pct(mean) + '%' } }),
      // Marker
      el('div', { class: 'vb-marker', style: { left: pct(value) + '%' } })
    ]),
    el('div', { class: 'vb-axis' }, [
      el('span', {}, `${min.toFixed(1)} min`),
      el('span', {}, `−1σ ${sigmaMinus.toFixed(1)}`),
      el('span', {}, `${mean.toFixed(1)} mean`),
      el('span', {}, `+1σ ${sigmaPlus.toFixed(1)}`),
      el('span', {}, `${max.toFixed(1)} max`)
    ]),
    asof ? el('div', { style: { fontSize: '10px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '8px', textAlign: 'right' } }, 'as on ' + asof) : null
  ].filter(Boolean));
}

// ──────────────────────────────────────────────────────────────
// renderPercentileStrip · histogram with marker for current value
// dist: array of bucket counts (left-to-right low-to-high)
// value, percentile: scalars; valueLabel: display string
// ──────────────────────────────────────────────────────────────
export function renderPercentileStrip({ dist, percentile, valueLabel, lowLabel, highLabel, summary }) {
  const width = 320, height = 70, padTop = 14, padBottom = 16, padLeft = 6, padRight = 6;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const maxCount = Math.max(...dist, 1);
  const barW = innerW / dist.length;
  const svg = svgEl('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet' });
  dist.forEach((c, i) => {
    const h = (c / maxCount) * innerH;
    const fill = i / dist.length > 0.7 ? '#5a2a2a' : i / dist.length > 0.55 ? '#3a1c1c' : i / dist.length > 0.45 ? '#4a5566' : '#2d3542';
    svg.appendChild(svgEl('rect', { x: padLeft + i * barW, y: padTop + innerH - h, width: barW - 1, height: h, fill }));
  });
  // Percentile marker
  const markerX = padLeft + (percentile / 100) * innerW;
  svg.appendChild(svgEl('line', { x1: markerX, y1: 4, x2: markerX, y2: padTop + innerH, stroke: 'var(--red)', 'stroke-width': 2 }));
  const lbl = svgEl('text', { x: markerX, y: 12, fill: 'var(--red)', 'font-family': 'JetBrains Mono', 'font-size': 10, 'text-anchor': 'middle', 'font-weight': 600 });
  lbl.textContent = `${valueLabel} · ${percentile}p`; svg.appendChild(lbl);
  // Axis
  const lo = svgEl('text', { x: padLeft, y: height - 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 9 });
  lo.textContent = lowLabel; svg.appendChild(lo);
  const hi = svgEl('text', { x: width - padRight, y: height - 4, fill: 'var(--ink-3)', 'font-family': 'JetBrains Mono', 'font-size': 9, 'text-anchor': 'end' });
  hi.textContent = highLabel; svg.appendChild(hi);

  const wrap = el('div', { class: 'viz-wrap' });
  wrap.appendChild(svg);
  if (summary) wrap.appendChild(el('div', { style: { fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '6px' } }, summary));
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderSeasonalityStrip · paired-bar 12-month chart, current vs prior 12m
// Used in Real Economy cluster expansions (Option 1 placement) to show
// whether a metric's reading is structural growth or just seasonal rhythm.
// curr / prior: arrays of 12 numeric values, oldest → newest, ending at as_of
// labels: array of 12 month names (e.g. ['May','Jun', ...]) — caller-provided
// ──────────────────────────────────────────────────────────────
export function renderSeasonalityStrip({ curr, prior, labels, title, asof, summary, valueFormatter }) {
  const max = Math.max(...curr, ...prior, 1);
  const fmt = valueFormatter || ((v) => v.toFixed(1));
  const wrap = el('div', { class: 'viz-wrap', style: { background: '#0e1218', border: '1px solid var(--line)', borderRadius: '6px', padding: '14px 16px', marginTop: '14px' } });
  wrap.appendChild(vizTitleEl(title || 'Seasonality · current 12m vs prior 12m', asof));
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '4px', marginTop: '10px' } });
  for (let i = 0; i < 12; i++) {
    const cH = (curr[i] / max) * 70;
    const pH = (prior[i] / max) * 70;
    const month = el('div', { style: { textAlign: 'center' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'center', gap: '2px', alignItems: 'flex-end', height: '70px', marginBottom: '6px' }, title: `${labels[i]}: prior ${fmt(prior[i])} · current ${fmt(curr[i])}` }, [
        el('div', { style: { width: '8px', height: pH + 'px', background: 'var(--ink-3)', borderRadius: '2px 2px 0 0' } }),
        el('div', { style: { width: '8px', height: cH + 'px', background: 'var(--accent)', borderRadius: '2px 2px 0 0' } })
      ]),
      el('div', { style: { fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' } }, labels[i])
    ]);
    grid.appendChild(month);
  }
  wrap.appendChild(grid);
  // Above-prior count
  const above = curr.reduce((n, v, i) => n + (v > prior[i] ? 1 : 0), 0);
  const lege = el('div', { class: 'viz-legend-row', style: { marginTop: '10px' } }, [
    el('span', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: { background: 'var(--accent)' } }), 'last 12m']),
    el('span', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: { background: 'var(--ink-3)' } }), 'prior 12m']),
    el('span', { style: { marginLeft: 'auto', color: 'var(--ink-2)' } },
      summary || `Above prior in ${above} of 12 — ${above >= 9 ? 'structural growth' : above >= 6 ? 'mostly above trend' : above >= 3 ? 'mixed' : 'below trend'}.`)
  ]);
  wrap.appendChild(lege);
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderStatStrip · Option A · 5-cell horizontal stats above a chart
// items: [{ label, value, sub, color }] — caller picks 3-5 cells
// Designed to sit directly above an existing viz; collapses on small screens.
// ──────────────────────────────────────────────────────────────
export function renderStatStrip(items, opts = {}) {
  const cells = items.map(it => el('div', { class: 'stat-cell' }, [
    el('div', { class: 'stat-label' }, it.label),
    el('div', { class: 'stat-value', style: { color: it.color || 'var(--ink)' } }, it.value),
    it.sub ? el('div', { class: 'stat-sub' }, it.sub) : null
  ].filter(Boolean)));
  return el('div', { class: 'stat-strip', style: { gridTemplateColumns: `repeat(${items.length}, 1fr)` } }, cells);
}

// ──────────────────────────────────────────────────────────────
// renderHeadlinePanel · Option C · Hormuz-style header + 4-cell matrix
// Used for shock-eligible / driver panels (Brent, Indexed Equity, Oil & physical).
//
// Shape:
//   [eyebrow line]
//   [BIG VALUE]                          [STATUS PILL]
//   [meta line · threshold]              [meta sub]
//   [MoM | YoY | percentile inline]
//   [optional chart]
//   [4-cell sub-metrics matrix]
// ──────────────────────────────────────────────────────────────
export function renderHeadlinePanel({
  eyebrow, value, metaLine, threshold, mom, yoy, percentile,
  statusPill, statusSub, status,
  chart, chartTitle, chartAsof,
  matrix, asof, eyebrowColor
}) {
  // Header card — alarming red bg if shock, neutral panel-2 otherwise
  const isShock = status === 'shock';
  const headerStyle = isShock
    ? { background: 'rgba(58,28,28,0.55)', border: '1px solid rgba(120,40,40,0.6)' }
    : { background: 'var(--panel-2)', border: '1px solid var(--line)' };

  const trendsLine = el('div', { class: 'hp-trends', style: { display: 'flex', gap: '18px', marginTop: '10px', fontSize: '12px', color: 'var(--ink-2)', fontFamily: 'var(--mono)', flexWrap: 'wrap' } }, [
    mom ? el('span', {}, ['MoM ', el('b', { style: { color: mom.color || 'var(--ink)' } }, mom.text)]) : null,
    yoy ? el('span', {}, ['YoY ', el('b', { style: { color: yoy.color || 'var(--ink)' } }, yoy.text)]) : null,
    percentile ? el('span', {}, [percentile.label || '5Y percentile ', el('b', { style: { color: percentile.color || 'var(--ink)' } }, percentile.text)]) : null
  ].filter(Boolean));

  const header = el('div', { class: 'headline-panel-header', style: { ...headerStyle, borderRadius: '8px', padding: '18px 22px', marginBottom: '14px' } }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' } }, [
      el('div', { style: { flex: 1, minWidth: 0 } }, [
        eyebrow ? el('div', { style: { fontSize: '11px', color: eyebrowColor || 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--mono)', marginBottom: '6px', fontWeight: 600 } }, eyebrow) : null,
        el('div', { style: { fontSize: '32px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--ink)', marginBottom: '4px', lineHeight: '1.1' } }, value),
        metaLine ? el('div', { style: { fontSize: '11.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' } }, [
          metaLine,
          threshold ? el('span', { style: { color: 'var(--ink-2)', marginLeft: '14px' } }, [
            'Threshold: ', el('b', { style: { color: 'var(--ink)' } }, threshold)
          ]) : null
        ].filter(Boolean)) : null,
        trendsLine
      ].filter(Boolean)),
      statusPill ? el('div', { style: { textAlign: 'right', flexShrink: 0 } }, [
        el('span', { class: 'pill ' + statusClass(status || 'med') }, statusPill),
        statusSub ? el('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' } }, statusSub) : null
      ].filter(Boolean)) : null
    ].filter(Boolean))
  ]);

  const wrap = el('div', { class: 'viz-wrap headline-panel' });
  wrap.appendChild(header);
  if (chart) {
    if (chartTitle) wrap.appendChild(vizTitleEl(chartTitle, chartAsof));
    wrap.appendChild(chart);
  }
  if (matrix && matrix.length) {
    const matrixWrap = el('div', { class: 'hp-matrix', style: { marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '14px' } });
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${matrix.length}, 1fr)`, gap: '14px' } });
    for (const cell of matrix) {
      grid.appendChild(el('div', { class: 'hp-matrix-cell', title: cell.tooltip || '', style: { background: '#0e1218', border: '1px solid var(--line)', borderRadius: '6px', padding: '12px 14px' } }, [
        el('div', { style: { fontSize: '10px', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--mono)', fontWeight: 600 } }, cell.label),
        el('div', { style: { fontSize: '17px', fontWeight: 700, fontFamily: 'var(--mono)', marginTop: '6px', color: cell.valueColor || 'var(--ink)' } }, cell.value),
        cell.sub1 ? el('div', { style: { fontSize: '11.5px', fontFamily: 'var(--mono)', marginTop: '4px', color: cell.sub1Color || 'var(--ink-2)' } }, cell.sub1) : null,
        cell.sub2 ? el('div', { style: { fontSize: '10.5px', fontFamily: 'var(--mono)', marginTop: '2px', color: 'var(--ink-3)' } }, cell.sub2) : null,
        cell.asof ? el('div', { style: { fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '8px', borderTop: '1px dashed var(--line-2)', paddingTop: '5px' } }, 'as on ' + cell.asof) : null
      ].filter(Boolean)));
    }
    matrixWrap.appendChild(grid);
    wrap.appendChild(matrixWrap);
  }
  return wrap;
}

// ──────────────────────────────────────────────────────────────
// renderTodayBullets · bullet-row Today line (Design Audit §10 fix)
// items: [{ html, drawer_metric_id }]
// ──────────────────────────────────────────────────────────────
// Items now support optional `icon` ('shock' | 'watch' | 'calm' | 'arrow')
// and the bullet grid lays out as 2-col on screens ≥1100px (CSS-driven).
const ICON_GLYPH = { shock: '◆', watch: '●', calm: '✓', arrow: '→' };
const ICON_COLOR = { shock: 'var(--red)', watch: 'var(--amber)', calm: 'var(--green)', arrow: 'var(--accent)' };

export function renderTodayBullets(items, opts = {}) {
  const onClick = opts.onClick || (() => {});
  return el('div', { class: 'today-bullets' }, [
    el('div', { class: 'tb-head' }, 'Today'),
    el('div', { class: 'tb-grid' }, items.map(item => {
      const iconType = item.icon || 'arrow';
      const glyph = ICON_GLYPH[iconType] || '→';
      const colour = ICON_COLOR[iconType] || 'var(--accent)';
      return el('div', {
        class: 'tb-row',
        onclick: () => item.drawer_metric_id && onClick(item.drawer_metric_id)
      }, [
        el('span', { class: 'tb-icon', style: { color: colour } }, glyph),
        el('span', { class: 'tb-text', html: item.html })
      ]);
    }))
  ]);
}

// Auto-narrative for the Hero · pulls from live driver scores and produces
// a punchy 1-2 sentence readout. Returns null if data is missing.
export function buildHeroNarrative(driverEntries, riskMetric) {
  if (!driverEntries || driverEntries.length === 0) return null;
  // Top-2 stress drivers by score
  const sorted = driverEntries.filter(d => typeof d.value === 'number')
    .sort((a, b) => b.value - a.value);
  if (sorted.length < 2) return null;
  const top1 = sorted[0];
  const top2 = sorted[1];
  const calmest = sorted[sorted.length - 1];
  const lead = `Stress is led by <b>${top1.label.replace(/^⚠\s/, '')} ${Math.round(top1.value)}</b> and <b>${top2.label.replace(/^⚠\s/, '')} ${Math.round(top2.value)}</b>.`;
  const tail = ` Real economy holding at <b>${Math.round(calmest.value)}</b>.`;
  return el('div', {
    class: 'hv-narrative',
    style: {
      marginTop: '12px',
      padding: '10px 14px',
      background: 'rgba(212,165,116,0.05)',
      borderLeft: '3px solid var(--accent)',
      borderRadius: '0 4px 4px 0',
      fontSize: '12.5px',
      color: 'var(--ink-2)',
      fontStyle: 'italic',
      lineHeight: '1.55'
    },
    html: lead + tail
  });
}
