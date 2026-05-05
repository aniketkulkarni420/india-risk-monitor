// Sparkline · primitive SVG
// Used by DisplayTile and TableRow.
//
// Props:
//   data: number[]                      — required; if empty → renders dashed line + "history pending"
//   width: number = 80
//   height: number = 22
//   fill: bool = false                  — area fill under line
//   color: string                       — stroke color (default: auto-pick by trend direction)
//   trend_direction: 'good'|'bad'|'neutral'
//
// Returns: SVG element

import { el } from './utils.mjs';

const NS = 'http://www.w3.org/2000/svg';

function autoColor(data, trend_direction) {
  if (!data || data.length < 2) return 'var(--ink-3)';
  const first = data[0], last = data[data.length - 1];
  const rising = last > first;
  if (trend_direction === 'good')    return rising ? 'var(--green)' : 'var(--red)';
  if (trend_direction === 'bad')     return rising ? 'var(--red)'   : 'var(--green)';
  return rising ? 'var(--green)' : 'var(--red)';
}

export function renderSparkline(props = {}) {
  const {
    data = [],
    width = 80,
    height = 22,
    fill = false,
    color: colorOverride,
    trend_direction = 'neutral',
    pad = 2
  } = props;

  // Empty-state: dashed flat line — never just empty
  if (!data || data.length === 0) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark spark-empty-svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', String(height / 2));
    line.setAttribute('x2', String(width));
    line.setAttribute('y2', String(height / 2));
    line.setAttribute('stroke', 'var(--line-2)');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '3,3');
    svg.appendChild(line);
    return svg;
  }

  const color = colorOverride || autoColor(data, trend_direction);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = innerW / Math.max(1, data.length - 1);

  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / range) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  if (fill) {
    const gradId = `sg${Math.random().toString(36).slice(2, 8)}`;
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const s1 = document.createElementNS(NS, 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', color); s1.setAttribute('stop-opacity', '0.25');
    const s2 = document.createElementNS(NS, 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', color); s2.setAttribute('stop-opacity', '0');
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('fill', `url(#${gradId})`);
    poly.setAttribute('points', `${points.join(' ')} ${(pad + innerW).toFixed(2)},${height} ${pad.toFixed(2)},${height}`);
    svg.appendChild(poly);
  }

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('points', points.join(' '));
  svg.appendChild(line);

  return svg;
}
