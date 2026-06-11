// Mobile assembly · Phase 7 + 5.5 redesign applied
// Hero: vital-signs panel (band + 6 driver bars) + Today bullet rows
// Section pills inherit redesign — Flows uses regime banner + horizon cards;
// Real Economy shows cluster summary + auto small multiples; tables stay Pattern 1.

import { renderTableRow, renderTableHeader } from '../components/TableRow.mjs';
import { wire as wireDrawer, open as openDrawer } from '../components/MetricDrawer.mjs';
import { el, formatValue, formatTrend, formatAsOf, statusClass } from '../components/utils.mjs';
import {
  renderDriverBars, renderHorizonCard, renderTodayBullets, renderSmallMultiples
} from '../components/charts.mjs';

let DATA;
try {
  const res = await fetch('../dist/data.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  DATA = await res.json();
} catch (err) {
  document.getElementById('m-sections').innerHTML =
    `<div style="padding: 60px 18px; text-align: center; color: var(--red);">Data load failed: ${err.message}</div>`;
  throw err;
}

const M = (id) => DATA.metrics[id] || null;
wireDrawer(M);

const risk = M('india_risk_score');
const supply = M('supply_chain_state');

document.getElementById('m-h1').textContent = supply?.status === 'shock'
  ? 'Stress is high, but activity hasn’t broken.'
  : (risk?.value > 65 ? 'Risk elevated. Watching the next move.' : 'Risk contained.');

document.getElementById('m-stress').appendChild(
  el('span', { class: 'pill ' + statusClass(risk?.status || 'med') },
    `Stress · ${risk?.value || '—'} / 100`)
);

// ── Vital signs · condensed (replaces single primary tile)
const driverIds = ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
                   'driver_india_macro', 'driver_sector_breadth', 'driver_real_economy'];
const drivers = driverIds.map(M).filter(Boolean).map(d => ({
  label: (d.status === 'shock' ? '⚠ ' : '') + d.display_name,
  value: d.value, status: d.status,
  delta: d.mom_pct ? Math.round(d.value * d.mom_pct / 100) : null,
  metric_id: d.metric_id
})).sort((a, b) => b.value - a.value);

const primaryHost = document.getElementById('m-primary');
primaryHost.innerHTML = '';
const vitalCondensed = el('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px 16px' } }, [
  el('div', { style: { fontSize: '10px', color: 'var(--ink-3)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' } }, 'Drivers · sorted by pressure'),
  renderDriverBars(drivers, { showDelta: true, labelWidth: 100, max: 100 })
]);
vitalCondensed.querySelectorAll('.driver-bar-row').forEach((row, i) => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', () => openDrawer(drivers[i].metric_id));
});
primaryHost.appendChild(vitalCondensed);

// ── Today bullets
const today = document.getElementById('m-today');
today.innerHTML = '';
today.style.display = 'block';
today.style.background = 'transparent';
today.style.borderLeft = 'none';
today.style.padding = '0';
today.style.marginTop = '14px';
today.appendChild(renderTodayBullets([
  { html: '<a>Hormuz</a> 2/day vs 140 baseline · <b>14d in</b>', drawer_metric_id: 'hormuz_throughput' },
  { html: '<a>Brent</a> $98.40 · <b>+18% MoM</b>', drawer_metric_id: 'brent_crude' },
  { html: '<a>VLCC</a> rates <b>+220% MoM</b>', drawer_metric_id: 'vlcc_tanker_rates' },
  { html: '<a>DII absorbing</a> at <b>1.30×</b>', drawer_metric_id: 'absorption_ratio' },
  { html: '<a>Real economy</a> · GST <b>+11.5% YoY</b>', drawer_metric_id: 'gst_gross' }
], { onClick: openDrawer }));

// ──────────────────────────────────────────────────────────────
// Section pills
// ──────────────────────────────────────────────────────────────
function buildTable(ids) {
  const t = el('table', { class: 'metric-table' });
  t.appendChild(renderTableHeader(['Metric', 'Now', 'MoM', 'YoY', '12m', '']));
  for (const id of ids) {
    const m = M(id);
    if (m) t.appendChild(renderTableRow(m));
  }
  return t;
}

function pill(id, name, meta, body) {
  const det = el('details', { class: 'm-section', id: 'm-sec-' + id });
  det.appendChild(el('summary', {}, [
    el('span', { class: 'm-pill-name' }, name),
    el('span', { class: 'm-pill-meta' }, meta),
    el('span', { class: 'm-pill-arrow' }, '›')
  ]));
  det.appendChild(el('div', { class: 'm-section-body' }, [].concat(body).filter(Boolean)));
  return det;
}

const sectionsEl = document.getElementById('m-sections');
sectionsEl.innerHTML = '';

// Flows · regime + horizon cards (stacked)
const flowsBody = el('div', {}, [
  el('div', { style: { background: 'var(--surface-2)', borderLeft: '3px solid var(--green)', borderRadius: '0 6px 6px 0', padding: '10px 14px', marginBottom: '12px', fontSize: '12px' } }, [
    el('div', { style: { color: 'var(--green)', fontWeight: 700, fontSize: '14px' } }, 'DII Absorption'),
    el('div', { style: { color: 'var(--ink-2)', marginTop: '2px' } }, 'FII selling — DII buying enough · 8 sessions')
  ]),
  el('div', { class: 'horizon-grid' }, [
    renderHorizonCard('Today', -392, 'net ₹ Cr', -2103, 1712),
    renderHorizonCard('5 sess.', 4291, 'net ₹ Cr', -12400, 16691),
    renderHorizonCard('MTD', 4291, '₹ Cr · 1.30× absorb', -14305, 18596),
    renderHorizonCard('CYTD', 52820, 'net ₹ Cr', -42180, 95000)
  ]),
  el('div', { class: 'sub-head' }, 'Supporting'),
  buildTable(['net_sip_inflows', 'mf_net_equity_flows', 'fpi_debt_flows', 'fii_index_fut_positioning', 'block_deals_notional'])
]);
sectionsEl.appendChild(pill('flows', 'Flows', 'Absorption 1.30× · 8-sess streak', flowsBody));

// Macro
sectionsEl.appendChild(pill('macro', 'Macro',
  `INR ${M('inr_usd')?.value || '—'} · 10Y ${M('gsec_curve')?.value || '—'}% · CPI ${M('cpi_inflation')?.value || '—'}%`,
  buildTable(['inr_usd', 'fx_reserves', 'trade_deficit', 'cad_pct_gdp',
              'banking_liquidity', 'wacr_repo_spread', 'repo_rate', 'gsec_curve',
              'real_10y_yield', 'cpi_inflation', 'core_cpi', 'pmi_combined',
              'iip_growth', 'fiscal_deficit_pct', 'govt_capex_runrate', 'credit_deposit_growth'])
));

// Real Economy · cluster summary + auto small multiples
const econBody = el('div', {}, [
  el('div', { class: 'cluster-grid' }, [
    el('div', { class: 'cluster-card' }, [el('div', { class: 'cc-label' }, 'Tax & demand'), el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, '+11.5%')]),
    el('div', { class: 'cluster-card' }, [el('div', { class: 'cc-label' }, 'Movement'), el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, '+8.5%')]),
    el('div', { class: 'cluster-card' }, [el('div', { class: 'cc-label' }, 'Production'), el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, '+6.4%')]),
    el('div', { class: 'cluster-card' }, [el('div', { class: 'cc-label' }, 'Auto'), el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, '+8.5%')]),
    el('div', { class: 'cluster-card' }, [el('div', { class: 'cc-label' }, 'Discretionary'), el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, '+4.2%')])
  ]),
  el('div', { class: 'sub-head' }, 'Auto · YoY %'),
  renderSmallMultiples(
    ['auto_3w', 'auto_tractor', 'auto_2w', 'auto_cv', 'auto_pv'].map(M).filter(Boolean).map(m => ({
      label: m.display_name.replace(' retail registrations', '').replace(' retail', '').replace(' (4W)', ''),
      deltaPct: m.yoy_pct,
      color: m.yoy_pct > 0 ? 'var(--green)' : 'var(--red)',
      valueFormatted: formatValue(m.value, m.value_format)
    })),
    {}
  ),
  el('div', { class: 'sub-head' }, 'All metrics'),
  buildTable(['gst_gross', 'eway_bills', 'eight_core_industries', 'fastag_toll', 'rail_freight',
              'port_cargo', 'air_pax', 'pol_demand', 'power_demand', 'cement_dispatches',
              'steel_consumption', 'epfo_payrolls', 'reservoir_levels'])
]);
sectionsEl.appendChild(pill('economy', 'Real economy', 'GST +11.5% YoY · 18 metrics', econBody));

// Freight
sectionsEl.appendChild(pill('freight', 'Freight & supply chain',
  `Hormuz ${M('hormuz_throughput')?.value} ships · Brent $${M('brent_crude')?.value}`,
  buildTable(['hormuz_throughput', 'brent_crude', 'india_crude_basket', 'drewry_wci',
              'baltic_dirty_tanker', 'vlcc_tanker_rates'])
));

// Market
sectionsEl.appendChild(pill('market', 'Market context',
  `Nifty ${M('nifty_50')?.value?.toFixed(0)} · India VIX ${M('india_vix')?.value}`,
  buildTable(['nifty_50', 'bank_nifty', 'gift_nifty', 'nifty_pe_5y', 'india_vix', 'nifty_pcr',
              'gold_usd', 'dxy', 'ind_us_10y_spread', 'high_yield_credit_spread'])
));

// Sectors · ranked list (compact mobile)
const sectorOrder = { red: 0, amber: 1, neutral: 2, mixed: 2, green: 3 };
const sectors = (DATA.sectors?.sectors || []).slice()
  .sort((a, b) => (sectorOrder[a.drivers?.overall] ?? 4) - (sectorOrder[b.drivers?.overall] ?? 4));

const sectorList = el('div', { class: 'sector-list' });
sectors.forEach(s => {
  const overall = s.drivers?.overall || 'neutral';
  const overallPill = overall === 'red' ? 'p-high' : overall === 'amber' ? 'p-med' : overall === 'green' ? 'p-low' : 'p-med';
  const ret = s.quant?.return_1m_pct ?? 0;
  sectorList.appendChild(el('div', { class: 'sector-row' }, [
    el('div', { class: 'sr-name' }, s.display_name),
    el('div', { class: 'sr-status' }, [el('span', { class: 'pill ' + overallPill, style: { fontSize: '9px' } }, overall.toUpperCase())]),
    el('div', { class: 'sr-num', style: { color: ret > 0 ? 'var(--green)' : ret < 0 ? 'var(--red)' : 'var(--ink-2)' } }, (ret > 0 ? '+' : '') + ret.toFixed(1) + '%'),
    el('div', { class: 'sr-num' }, ''),
    el('div', { class: 'sr-why' }, '')
  ]));
});

const greenCount = sectors.filter(s => s.drivers?.overall === 'green').length;
const redCount = sectors.filter(s => s.drivers?.overall === 'red').length;
sectionsEl.appendChild(pill('sectors', 'Sectors', `${greenCount} green · ${redCount} red`, sectorList));

console.log(`[IRM mobile · Phase 5.5] mounted ${Object.keys(DATA.metrics).length} metrics`);
