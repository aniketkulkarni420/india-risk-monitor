// Band · risk-score viz
// Replaces the orb. Horizontal track with low/med/high zones + marker.
//
// Props:
//   value: number                       — required
//   min: number = 0
//   max: number = 100
//   zones: [{ label, end, color, class }] = standard low/med/high
//   show_value: bool = true
//   context: { mom_pct, yoy_pct, range_min, range_max } = optional inline context

import { el } from './utils.mjs';

const STANDARD_ZONES = [
  { label: 'Low',   end: 35,  class: 'band-zone-low' },
  { label: 'Med',   end: 65,  class: 'band-zone-med' },
  { label: 'High',  end: 100, class: 'band-zone-high' }
];

export function renderBand(props = {}) {
  const {
    value,
    min = 0,
    max = 100,
    zones = STANDARD_ZONES,
    context = null
  } = props;

  if (value === null || value === undefined) {
    return el('div', { class: 'band-wrap' }, el('div', { class: 'spark-empty', text: 'history pending' }));
  }

  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const wrap = el('div', { class: 'band-wrap' });

  const track = el('div', { class: 'band-track' });
  const marker = el('div', { class: 'band-marker', style: { left: (pct * 100).toFixed(1) + '%' } });
  track.appendChild(marker);
  wrap.appendChild(track);

  const zonesRow = el('div', { class: 'band-zones' });
  let cursor = min;
  for (const z of zones) {
    zonesRow.appendChild(el('span', { class: z.class || '' }, `${z.label} ${cursor}–${z.end}`));
    cursor = z.end;
  }
  wrap.appendChild(zonesRow);

  if (context) {
    const ctx = el('div', { class: 'band-context' });
    if (context.mom_pct != null) {
      ctx.appendChild(el('span', {}, ['MoM ', el('b', {}, (context.mom_pct > 0 ? '+' : '') + context.mom_pct.toFixed(1))]));
    }
    if (context.yoy_pct != null) {
      ctx.appendChild(el('span', {}, ['YoY ', el('b', {}, (context.yoy_pct > 0 ? '+' : '') + context.yoy_pct.toFixed(1))]));
    }
    if (context.range_min != null && context.range_max != null) {
      ctx.appendChild(el('span', {}, ['1Y range ', el('b', {}, `${context.range_min}–${context.range_max}`)]));
    }
    wrap.appendChild(ctx);
  }

  return wrap;
}
