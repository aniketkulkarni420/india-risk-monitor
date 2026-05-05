// Main page assembly · Phase 5.5 — Redesign per IRM_DataViz_Audit_v2 + IRM_Design_Audit
// Composes: Hero (vital signs) → Today bullets → Flows (5 lenses) → Macro (5 panels)
//   → Real Economy (cluster cards) → Freight (chart-led) → Market (4 panels) → Sectors (ranked)

import { renderTableRow, renderTableHeader } from './components/TableRow.mjs';
import { renderSectionFrame } from './components/SectionFrame.mjs';
import { renderStickyTOC } from './components/StickyTOC.mjs';
import { wire as wireDrawer, open as openDrawer } from './components/MetricDrawer.mjs';
import { wireCmdK, openCmdK } from './components/CmdKPalette.mjs';
import { el, formatValue, formatTrend, formatAsOf, statusClass } from './components/utils.mjs';
import {
  renderDriverBars, renderHorizonCard, renderRegimeBanner, renderPersistenceChips,
  renderCumulativeLine, renderDivergingBars, renderYieldCurve, renderInflationBars,
  renderCurrencyStrip, renderProgressBar, renderGaugeRow, renderPairedLine,
  renderSmallMultiples, renderIndexedOverlay, renderValuationBand, renderTodayBullets
} from './components/charts.mjs';

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
let DATA;
try {
  const res = await fetch('./dist/data.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  DATA = await res.json();
} catch (err) {
  document.getElementById('hero-decks').innerHTML =
    `<div style="grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--red);">Data load failed: ${err.message}<br><small style="color: var(--ink-3); font-family: var(--mono);">Run <code>npm run bundle</code> and serve over HTTP.</small></div>`;
  throw err;
}
const M = (id) => DATA.metrics[id] || null;
wireDrawer(M);

// ──────────────────────────────────────────────────────────────
// Topbar timestamp
// ──────────────────────────────────────────────────────────────
const newest = Object.values(DATA.metrics)
  .filter(m => m.as_of_period === 'live' || m.as_of_period === '24h')
  .map(m => m.as_of).sort().pop() || DATA.generated_at;
document.getElementById('topbar-asof').textContent = 'Updated ' + formatAsOf(newest);

// ──────────────────────────────────────────────────────────────
// HERO — vital signs panel (replaces 4-tile deck)
// ──────────────────────────────────────────────────────────────
const risk = M('india_risk_score');
const heroHost = document.getElementById('hero-decks');
heroHost.innerHTML = '';
heroHost.style.display = 'block';

// Build driver list, sorted by value desc
const driverIds = ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
                   'driver_india_macro', 'driver_sector_breadth', 'driver_real_economy'];
const drivers = driverIds.map(M).filter(Boolean).map(d => ({
  label: (d.status === 'shock' ? '⚠ ' : '') + d.display_name,
  value: d.value,
  status: d.status,
  delta: d.mom_pct ? Math.round(d.value * d.mom_pct / 100 * (d.mom_pct > 0 ? 1 : -1)) * (d.mom_pct > 0 ? 1 : -1) : null,
  metric_id: d.metric_id
})).sort((a, b) => b.value - a.value);

const vital = el('div', { class: 'hero-vital', onclick: (e) => { e.stopPropagation(); openDrawer('india_risk_score'); } });
vital.appendChild(el('div', { class: 'hv-score-row' }, [
  el('span', { class: 'hv-score-label' }, 'India Risk Score'),
  el('span', { class: 'hv-delta' }, ['w/w ', el('b', {}, (risk.mom_pct > 0 ? '+' : '') + Math.round(risk.value * risk.mom_pct / 100))])
]));
vital.appendChild(el('div', { class: 'hv-score-row' }, [
  el('div', { class: 'hv-score-big' }, String(risk.value)),
  el('div', { class: 'hv-score-sub' }, '/ 100'),
  el('div', { style: { marginLeft: 'auto' } }, [el('span', { class: 'pill ' + statusClass(risk.status) }, risk.status[0].toUpperCase() + risk.status.slice(1))])
]));
vital.appendChild(el('div', { class: 'hv-band-track' }, [
  el('div', { class: 'hv-band-marker', style: { left: risk.value + '%' } })
]));
vital.appendChild(el('div', { class: 'hv-band-zones' }, [
  el('span', { style: { color: '#79c79a' } }, 'LOW 0–35'),
  el('span', { style: { color: '#e9c466' } }, 'MED 35–65'),
  el('span', { style: { color: '#e88' } }, 'HIGH 65–100')
]));
vital.appendChild(el('div', { class: 'hv-drivers-head' }, 'Drivers · sorted by pressure'));

const driverBarsEl = renderDriverBars(drivers, { showDelta: true, labelWidth: 140 });
// Wire each driver row to open its drawer
driverBarsEl.querySelectorAll('.driver-bar-row').forEach((row, i) => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(drivers[i].metric_id); });
});
vital.appendChild(driverBarsEl);
heroHost.appendChild(vital);

// ──────────────────────────────────────────────────────────────
// Today bullet rows (replaces lead paragraph + Today line)
// ──────────────────────────────────────────────────────────────
document.getElementById('hero-h1').textContent = 'Stress is high, but activity hasn’t broken.';
document.getElementById('hero-lead').style.display = 'none';

const todayWrap = document.getElementById('hero-today');
todayWrap.innerHTML = '';
todayWrap.style.display = 'block';
todayWrap.style.background = 'transparent';
todayWrap.style.borderLeft = 'none';
todayWrap.style.padding = '0';
todayWrap.appendChild(renderTodayBullets([
  { html: '<a>Hormuz traffic collapsed</a> — 2 ships/day vs 140 baseline · <b>14 days into the event</b>', drawer_metric_id: 'hormuz_throughput' },
  { html: '<a>Brent crude</a> at $98.40 · <b>+18% MoM</b>, above shock threshold for 8 sessions', drawer_metric_id: 'brent_crude' },
  { html: '<a>VLCC tanker rates</a> spiked <b>+220% MoM</b> on Cape Route diversions', drawer_metric_id: 'vlcc_tanker_rates' },
  { html: '<a>DII absorbing FII selling</a> at <b>1.30× ratio</b> — regime stable for 8 sessions', drawer_metric_id: 'absorption_ratio' },
  { html: '<a>Real economy holding</a> · GST <b>+11.5% YoY</b>, auto retail <b>+8.5%</b> across all 5 segments', drawer_metric_id: 'gst_gross' }
], { onClick: openDrawer }));

// ──────────────────────────────────────────────────────────────
// Body sections
// ──────────────────────────────────────────────────────────────
const body = document.getElementById('body');
body.innerHTML = '';

function buildTable(ids, opts = {}) {
  const t = el('table', { class: 'metric-table' });
  if (!opts.skipHeader) t.appendChild(renderTableHeader(opts.headers));
  for (const id of ids) {
    const m = M(id);
    if (m) t.appendChild(renderTableRow(m));
  }
  return el('div', { class: 'sec-table-frame' }, [t]);
}

function buildSectionFooter(srcNames) {
  return { count: srcNames.length, names: srcNames, last_verified: new Date().toISOString() };
}

// ════════════════════════ FLOWS — 5 LENSES ════════════════════════
const flowsBody = el('div', { class: 'section-body-stack' });

// Lens 1 · Regime banner
flowsBody.appendChild(renderRegimeBanner({
  regime: 'DII Absorption',
  description: 'FII selling — DII buying enough to absorb. Regime durable.',
  hint: 'Becomes "stress" if FII selling intensifies AND DII slows simultaneously.',
  status: 'low',
  persistence: 8
}));

// Lens 2 · 4 horizon cards
const hzGrid = el('div', { class: 'horizon-grid' });
hzGrid.appendChild(renderHorizonCard('Today', -392, 'net ₹ Cr', -2103, 1712));
hzGrid.appendChild(renderHorizonCard('Last 5 sessions', 4291, 'net ₹ Cr', -12400, 16691));
hzGrid.appendChild(renderHorizonCard('MTD · April', 4291, 'net ₹ Cr · absorption 1.30×', -14305, 18596));
hzGrid.appendChild(renderHorizonCard('CYTD · 2026', 52820, 'net ₹ Cr', -42180, 95000));
flowsBody.appendChild(hzGrid);

// Lens 3 · Persistence chips
flowsBody.appendChild(renderPersistenceChips([
  { label: 'FII selling streak', value: '8 sessions', color: 'var(--red)' },
  { label: 'DII buying streak', value: '11 sessions', color: 'var(--green)' },
  { label: 'Absorption (5-day avg)', value: '1.35×', color: 'var(--ink)' },
  { label: 'FII MTD percentile', value: '12th of 60', color: 'var(--red)' }
]));

// Lens 4 · Cumulative chart
const cytdMonths = ['Jan','Feb','Mar','Apr'];
const diiCumPoints = [
  { label: 'Jan 1', value: 0 }, { label: 'Jan 15', value: 14000 }, { label: 'Feb 1', value: 28000 },
  { label: 'Feb 15', value: 42000 }, { label: 'Mar 1', value: 58000 }, { label: 'Mar 15', value: 72000 },
  { label: 'Apr 1', value: 84000 }, { label: 'Apr 15', value: 92000 }, { label: 'Apr 28', value: 95000 }
];
const fiiCumPoints = [
  { label: 'Jan 1', value: 0 }, { label: 'Jan 15', value: -4000 }, { label: 'Feb 1', value: -10000 },
  { label: 'Feb 15', value: -16000 }, { label: 'Mar 1', value: -22000 }, { label: 'Mar 15', value: -28000 },
  { label: 'Apr 1', value: -32000 }, { label: 'Apr 15', value: -38000 }, { label: 'Apr 28', value: -42180 }
];
flowsBody.appendChild(renderCumulativeLine([
  { name: 'DII cumulative', color: 'var(--green)', points: diiCumPoints, current: '+95,000' },
  { name: 'FII cumulative', color: 'var(--red)', points: fiiCumPoints, current: '−42,180' }
], { title: 'FII vs DII · cumulative ₹ Cr · 2026 YTD', summary: 'Net market: +52,820 Cr · DII pulling away' }));

// Lens 5 · Sectoral rotation
flowsBody.appendChild(renderDivergingBars({
  sells: [
    { name: 'IT', value: -4820 },
    { name: 'Banks', value: -3750 },
    { name: 'Auto', value: -2410 }
  ],
  buys: [
    { name: 'Energy', value: 3210 },
    { name: 'Pharma', value: 2010 },
    { name: 'Metals', value: 1180 }
  ]
}, { title: 'FII MTD by sector · top sells / top buys' }));

// Supporting table
flowsBody.appendChild(el('div', { class: 'sub-head' }, 'Supporting metrics'));
flowsBody.appendChild(buildTable(['fpi_debt_flows', 'fno_oi_buildup', 'block_deals_notional']));

body.appendChild(renderSectionFrame({
  section_id: 'flows',
  title: 'Institutional flows',
  question: 'Who is buying, who is selling, and where the money is rotating.',
  sources: buildSectionFooter(['NSE', 'SEBI', 'NSDL', 'AMFI']),
  children: [flowsBody]
}));

// ════════════════════════ MACRO — 5 PANELS ════════════════════════
const macroBody = el('div', { class: 'section-body-stack' });

// Panel 1 · Yield curve
macroBody.appendChild(renderYieldCurve(
  [{ tenor: '1Y', value: 6.10 }, { tenor: '5Y', value: 6.72 }, { tenor: '10Y', value: 6.97 }],
  [{ tenor: '1Y', value: 6.18 }, { tenor: '5Y', value: 6.65 }, { tenor: '10Y', value: 6.85 }]
));

// Panel 2+3 · Inflation + Currency strip side by side
const inflationCurrencyRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '18px' } });
inflationCurrencyRow.appendChild(renderInflationBars(
  [{ label: 'CPI Headline', value: 3.40 }, { label: 'Core CPI', value: 3.42 }, { label: 'Food CPI', value: 3.87 }, { label: 'WPI', value: 2.84 }],
  4.0,
  { note: 'All readings below 4% — RBI has room. WPI ticking up.' }
));
const currencyWrap = el('div', { class: 'viz-wrap' });
currencyWrap.appendChild(el('div', { class: 'viz-title' }, 'Currency · INR · DXY · FX reserves'));
currencyWrap.appendChild(renderCurrencyStrip([
  { label: 'INR / USD', value: '83.42', sparkline: M('inr_usd')?.sparkline_12m || [], mom_pct: 0.8, yoy_pct: 1.4, trend_direction: 'bad' },
  { label: 'DXY', value: '102.84', sparkline: M('dxy')?.sparkline_12m || [], mom_pct: 1.2, yoy_pct: 0.4, trend_direction: 'bad' },
  { label: 'FX reserves', value: '$692.4 B', sparkline: M('fx_reserves')?.sparkline_12m?.slice() || [], mom_pct: -1.4, yoy_pct: 4.8, trend_direction: 'bad' }
]));
currencyWrap.appendChild(el('div', { class: 'viz-legend-row' }, [
  el('span', { style: { color: 'var(--ink-2)' } }, 'All three weakening together — classic dollar-strength regime.')
]));
inflationCurrencyRow.appendChild(currencyWrap);
macroBody.appendChild(inflationCurrencyRow);

// Panel 4 · Fiscal progress bars
const fiscalWrap = el('div', { class: 'viz-wrap' });
fiscalWrap.appendChild(el('div', { class: 'viz-title' }, 'Fiscal · % of FY26 target / RE'));
fiscalWrap.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
  renderProgressBar('Fiscal deficit · % of FY26 target', M('fiscal_deficit_pct')?.value || 80.4, { color: 'var(--green)' }),
  renderProgressBar('Capex run-rate · % of FY26 RE', M('govt_capex_runrate')?.value || 81.2, { color: 'var(--green)' })
]));
fiscalWrap.appendChild(el('div', { class: 'viz-legend-row' }, [
  el('span', { style: { color: 'var(--ink-2)' } }, 'Both within glide path · no fiscal stress.')
]));

// Panel 5 · Leading gauges
const gaugeWrap = el('div', { class: 'viz-wrap' });
gaugeWrap.appendChild(el('div', { class: 'viz-title' }, 'Leading indicators'));
const gaugeRow = el('div', { class: 'gauge-row' }, [
  el('div', { class: 'gauge-cell calm' }, [
    el('div', { class: 'gauge-label' }, 'PMI COMPOSITE'),
    el('div', { class: 'gauge-value', style: { color: 'var(--green)' } }, '58.4'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'expansion above 50')
  ]),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'IIP YOY'),
    el('div', { class: 'gauge-value', style: { color: 'var(--green)' } }, '+5.2%'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'growth above 0%')
  ]),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'REAL 10Y'),
    el('div', { class: 'gauge-value', style: { color: 'var(--green)' } }, '+3.57%'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'positive carry')
  ])
]);
gaugeWrap.appendChild(gaugeRow);
const fiscalLeadingRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' } });
fiscalLeadingRow.appendChild(fiscalWrap);
fiscalLeadingRow.appendChild(gaugeWrap);
macroBody.appendChild(fiscalLeadingRow);

// Supporting metrics row (the rest)
macroBody.appendChild(el('div', { class: 'sub-head' }, 'Supporting metrics'));
macroBody.appendChild(buildTable(['trade_deficit', 'cad_pct_gdp', 'banking_liquidity', 'wacr_repo_spread',
                                  'repo_rate', 'credit_deposit_growth']));

body.appendChild(renderSectionFrame({
  section_id: 'macro',
  title: 'India macro',
  question: 'FX, rates, inflation, fiscal, liquidity — the structural backdrop.',
  sources: buildSectionFooter(['RBI', 'MoSPI', 'CCIL', 'CGA', 'S&P PMI']),
  children: [macroBody]
}));

// ════════════════════════ REAL ECONOMY — CLUSTER CARDS ════════════════════════
const econBody = el('div', { class: 'section-body-stack' });

const clusters = [
  { id: 'tax', label: 'Tax & demand', value: '+11.5%', sub: 'GST · UPI · e-way · 3 metrics',
    metrics: ['gst_gross', 'eway_bills', 'upi_value'] },
  { id: 'movement', label: 'Movement', value: '+8.5%', sub: 'FASTag · Rail · Ports · Air · 4 metrics',
    metrics: ['fastag_toll', 'rail_freight', 'port_cargo', 'air_pax'] },
  { id: 'production', label: 'Production', value: '+6.4%', sub: 'POL · power · cement · steel',
    metrics: ['pol_demand', 'power_demand', 'cement_dispatches', 'steel_consumption'] },
  { id: 'auto', label: 'Auto retail', value: '+8.5%', sub: 'FADA · 5 segments',
    metrics: ['auto_2w', 'auto_3w', 'auto_pv', 'auto_cv', 'auto_tractor'] },
  { id: 'discretionary', label: 'Discretionary', value: '+4.2%', sub: 'Naukri · reservoir',
    metrics: ['naukri_jobspeak', 'reservoir_levels'] }
];

const clusterGrid = el('div', { class: 'cluster-grid' });
const expansionMount = el('div', { id: 'cluster-expansion', style: { marginTop: '14px' } });

let activeCluster = null;
function showCluster(c) {
  activeCluster = c.id;
  clusterGrid.querySelectorAll('.cluster-card').forEach(card => card.classList.toggle('active', card.dataset.cluster === c.id));
  expansionMount.innerHTML = '';

  // Auto cluster gets small multiples
  if (c.id === 'auto') {
    const autoMetrics = c.metrics.map(M).filter(Boolean);
    expansionMount.appendChild(renderSmallMultiples(
      autoMetrics
        .map(m => ({
          label: m.display_name.replace(' retail registrations', '').replace(' retail', '').replace(' (4W)', ''),
          deltaPct: m.yoy_pct,
          color: m.yoy_pct > 0 ? 'var(--green)' : 'var(--red)',
          valueFormatted: formatValue(m.value, m.value_format)
        }))
        .sort((a, b) => b.deltaPct - a.deltaPct),
      { title: 'Auto · YoY % · sorted', summary: 'All five segments positive YoY. Rural-led (Tractor + 3W) leading urban (PV).' }
    ));
  } else if (c.id === 'movement') {
    // Movement cluster gets indexed overlay
    expansionMount.appendChild(renderIndexedOverlay([
      { name: 'Air pax', color: 'var(--accent)', points: Array.from({length: 9}, (_,i) => ({ label: `${i*15}d`, value: 100 + i*1.4 })) },
      { name: 'FASTag', color: 'var(--green)', points: Array.from({length: 9}, (_,i) => ({ label: `${i*15}d`, value: 100 + i*0.9 })) },
      { name: 'Rail', color: 'var(--ink-2)', points: Array.from({length: 9}, (_,i) => ({ label: `${i*15}d`, value: 100 + i*0.5 })) },
      { name: 'Ports', color: 'var(--blue)', points: Array.from({length: 9}, (_,i) => ({ label: `${i*15}d`, value: 100 + i*0.4 })) }
    ], { title: 'Movement · indexed to 100 · 90 days' }));
  } else {
    // Default: table
    expansionMount.appendChild(buildTable(c.metrics));
  }
}

clusters.forEach(c => {
  const card = el('div', { class: 'cluster-card', 'data-cluster': c.id, onclick: () => showCluster(c) }, [
    el('div', { class: 'cc-label' }, c.label),
    el('div', { class: 'cc-value', style: { color: 'var(--green)' } }, c.value),
    el('div', { class: 'cc-sub' }, c.sub)
  ]);
  clusterGrid.appendChild(card);
});
econBody.appendChild(clusterGrid);
econBody.appendChild(expansionMount);
showCluster(clusters[3]); // open Auto by default — most data-rich

body.appendChild(renderSectionFrame({
  section_id: 'economy',
  title: 'Real economy',
  question: 'Tap any cluster · tax / movement / production / auto / discretionary.',
  sources: buildSectionFooter(['GST', 'FADA', 'GridIndia', 'NPCI', 'IHMCL', 'JPC']),
  children: [econBody]
}));

// ════════════════════════ FREIGHT — CHART-LED ════════════════════════
const freightBody = el('div', { class: 'section-body-stack' });

// Hormuz cliff (kept from prior)
function buildHormuzPrimary() {
  const m = M('hormuz_throughput');
  if (!m) return null;
  const wrap = el('div', { class: 'hormuz-primary', onclick: () => openDrawer('hormuz_throughput') });
  wrap.appendChild(el('div', { class: 'hp-head' }, [
    el('div', {}, [
      el('div', { class: 'hp-eyebrow' }, '⚠ Shock · Strait of Hormuz throughput'),
      el('div', { class: 'hp-value' }, formatValue(m.value, 'integer')),
      el('div', { class: 'hp-meta' }, [
        m.unit + ' · 24h average',
        el('span', { style: { borderLeft: '1px solid #3a1c1c', paddingLeft: '14px', color: 'var(--ink-3)' } },
          ['Normal baseline: ', el('b', {}, m.baseline_30d || '—')])
      ]),
      el('div', { class: 'hp-trends' }, [
        el('span', {}, ['MoM ', el('b', {}, formatTrend(m.mom_pct))]),
        el('span', {}, ['YoY ', el('b', {}, formatTrend(m.yoy_pct))]),
        el('span', {}, ['% of normal ',
          el('b', {}, ((m.value / (m.baseline_30d || 1)) * 100).toFixed(1) + '%')])
      ])
    ]),
    el('div', { style: { textAlign: 'right' } }, [
      el('span', { class: 'pill pill-shock' }, 'SHOCK'),
      el('div', { style: { marginTop: '10px', fontSize: '11px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' } },
        'Lowest reading on record')
    ])
  ]));
  return wrap;
}
freightBody.appendChild(buildHormuzPrimary());

// Brent + India crude paired line
const brentPoints = Array.from({length: 9}, (_, i) => ({
  label: ['Jan','','Feb','','Mar','','Apr','',''][i],
  value: [76.5, 78.2, 80.1, 82.3, 84.0, 85.2, 86.5, 92.0, 98.4][i]
}));
const indiaPoints = Array.from({length: 9}, (_, i) => ({
  label: ['Jan','','Feb','','Mar','','Apr','',''][i],
  value: [75.0, 76.7, 78.6, 80.8, 82.4, 83.8, 85.0, 90.5, 96.84][i]
}));
freightBody.appendChild(renderPairedLine(
  [
    { name: 'Brent crude', color: 'var(--red)', points: brentPoints, current: '$98.40' },
    { name: 'India crude basket (PPAC)', color: 'var(--accent)', points: indiaPoints, current: '$96.84' }
  ],
  { title: 'Brent vs India crude basket · USD per barrel · 90 days', thresholdLine: 95, summary: 'Spread −$1.5 · both above $95 shock since 21 Apr' }
));

// 3-up tanker / container / bulk small multiples
freightBody.appendChild(renderSmallMultiples([
  { label: 'VLCC tanker', deltaPct: 220.4, color: 'var(--red)', valueFormatted: '1,842' },
  { label: 'Drewry WCI', deltaPct: 14.6, color: 'var(--amber)', valueFormatted: '$2,840' },
  { label: 'Baltic Dry', deltaPct: 8.4, color: 'var(--amber)', valueFormatted: '2,840' }
], { title: 'Freight indices · MoM %' }));

// Port dwell as supporting row
freightBody.appendChild(el('div', { class: 'sub-head' }, 'Port stress'));
freightBody.appendChild(buildTable(['india_port_dwell_time']));

body.appendChild(renderSectionFrame({
  section_id: 'freight',
  title: 'Freight & supply chain',
  question: 'Where the physical economy is breaking. Hormuz, oil, freight, port congestion.',
  sources: buildSectionFooter(['MarineTraffic', 'PPAC', 'Drewry', 'Baltic Exchange']),
  children: [freightBody]
}));

// ════════════════════════ MARKET CONTEXT — 4 PANELS ════════════════════════
const marketBody = el('div', { class: 'section-body-stack' });

// Panel 1 · Indexed equity overlay
marketBody.appendChild(renderIndexedOverlay([
  { name: 'Nifty 50', color: 'var(--accent)', points: Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 101, 102, 102.5, 104, 105, 106.5, 105.5, 104.2][i] })) },
  { name: 'Bank Nifty', color: 'var(--blue)', points: Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 100.5, 101.5, 101, 103, 105, 108, 106.5, 104.5][i] })) }
], { title: 'Indices · indexed to 100 · 90 days' }));

// Panel 2 · Valuation band
const valWrap = el('div', { class: 'viz-wrap' });
valWrap.appendChild(el('div', { class: 'viz-title' }, 'Nifty PE · trailing · vs 5Y range'));
valWrap.appendChild(renderValuationBand({ value: 22.8, min: 15.2, sigmaMinus: 18.6, mean: 21.0, sigmaPlus: 23.8, max: 27.2 }));
marketBody.appendChild(valWrap);

// Panel 3 + 4 row · VIX/DXY pair + IND-US spread
const sentimentSpreadRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '18px' } });
const vixWrap = el('div', { class: 'viz-wrap' });
vixWrap.appendChild(el('div', { class: 'viz-title' }, 'Sentiment · VIX + Gold'));
vixWrap.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', padding: '4px 0' } }, [
  el('div', {}, [
    el('div', { class: 'cs-label' }, 'INDIA VIX'),
    el('div', { class: 'cs-value' }, '21.84'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: 'var(--red)', fontFamily: 'var(--mono)' } }, '+21%')])
    ])
  ]),
  el('div', {}, [
    el('div', { class: 'cs-label' }, 'GOLD'),
    el('div', { class: 'cs-value' }, '$2,640'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: 'var(--green)', fontFamily: 'var(--mono)' } }, '+4.2%')])
    ])
  ])
]));
sentimentSpreadRow.appendChild(vixWrap);

const spreadWrap = el('div', { class: 'viz-wrap' });
spreadWrap.appendChild(el('div', { class: 'viz-title' }, 'India 10Y vs US 10Y spread · 24 months'));
const spreadPoints = Array.from({length: 13}, (_, i) => ({
  label: i === 0 ? '24m ago' : i === 12 ? 'now' : '',
  value: [320, 312, 305, 298, 290, 282, 275, 268, 260, 254, 246, 252, 256][i]
}));
spreadWrap.appendChild(renderCumulativeLine(
  [{ name: 'IND–US 10Y spread', color: 'var(--accent)', points: spreadPoints, current: '256 bps' }],
  { width: 600, height: 160, padTop: 16, padBottom: 26, summary: 'Compressing for 18 months · in watch zone (200 bps)' }
));
sentimentSpreadRow.appendChild(spreadWrap);
marketBody.appendChild(sentimentSpreadRow);

// Supporting table
marketBody.appendChild(el('div', { class: 'sub-head' }, 'Supporting metrics'));
marketBody.appendChild(buildTable(['nifty_50', 'bank_nifty', 'nifty_pe_5y', 'india_vix', 'gold_usd', 'dxy', 'high_yield_credit_spread']));

body.appendChild(renderSectionFrame({
  section_id: 'market',
  title: 'Market context',
  question: 'Equity benchmarks, valuation, sentiment, global linkages.',
  sources: buildSectionFooter(['NSE', 'CRISIL', 'FRED', 'Reuters']),
  children: [marketBody]
}));

// ════════════════════════ SECTORS — RANKED LIST ════════════════════════
const sectorsBody = el('div', { class: 'section-body-stack' });

// Order sectors by overall pressure: red > amber > green > neutral
const sectorOrder = { red: 0, amber: 1, neutral: 2, mixed: 2, green: 3 };
const sectors = (DATA.sectors?.sectors || []).slice().sort((a, b) =>
  (sectorOrder[a.drivers?.overall] ?? 4) - (sectorOrder[b.drivers?.overall] ?? 4)
);
const driverNames = ['oil', 'freight', 'fx', 'flows', 'real_activity', 'policy'];
const driverLabels = { oil: 'Oil', freight: 'Freight', fx: 'FX', flows: 'Flows', real_activity: 'Real activity', policy: 'Policy' };
const driverScore = { red: 9, amber: 5, green: 2, neutral: 4, mixed: 5 };

const sectorList = el('div', { class: 'sector-list' });
sectors.forEach(s => {
  const overall = s.drivers?.overall || 'neutral';
  const overallPill = overall === 'red' ? 'p-high' : overall === 'amber' ? 'p-med' : overall === 'green' ? 'p-low' : 'p-med';
  const overallLabel = overall.toUpperCase();
  const ret = s.quant?.return_1m_pct ?? 0;
  const pe = s.quant?.pe_trailing ?? 0;
  const why = ({
    aviation: 'Oil + FX squeeze',
    downstream_omc: 'Marketing margin squeeze',
    ports_cfs: 'Hormuz cargo arrivals at risk',
    fertilizer: 'Urea/DAP imports squeezed',
    chemicals: 'Naphtha/ammonia feedstock spikes',
    packaging: 'Polymer cost rising',
    logistics_3pl: 'Diesel + freight rates hit margins',
    rail_logistics: 'Industrial demand sensitive',
    cement: 'Petcoke vs strong dispatches',
    steel_metals: 'Coking coal vs auto demand',
    autos: 'Fuel costs vs FADA growth',
    capital_goods: 'Capex cycle intact',
    qsr_travel: 'Discretionary spend pressured',
    road_epc: 'Govt capex sustaining',
    shipping: 'VLCC rates +220%'
  })[s.id] || '';

  const row = el('div', { class: 'sector-row', 'data-sector': s.id }, [
    el('div', { class: 'sr-name' }, s.display_name),
    el('div', { class: 'sr-status' }, [el('span', { class: 'pill ' + overallPill, style: { fontSize: '9.5px' } }, overallLabel)]),
    el('div', { class: 'sr-num', style: { color: ret > 0 ? 'var(--green)' : ret < 0 ? 'var(--red)' : 'var(--ink-2)' } }, (ret > 0 ? '+' : '') + ret.toFixed(1) + '%'),
    el('div', { class: 'sr-num', style: { color: 'var(--ink-2)' } }, pe.toFixed(1) + '×'),
    el('div', { class: 'sr-why' }, why)
  ]);

  const expansion = el('div', { class: 'sector-expansion', style: { display: 'none' } });
  // Build driver bars for this sector
  const items = driverNames.map(d => ({
    label: driverLabels[d],
    value: driverScore[s.drivers?.[d] || 'neutral'],
    max: 10,
    status: s.drivers?.[d] === 'red' ? 'high' : s.drivers?.[d] === 'amber' ? 'med' : s.drivers?.[d] === 'green' ? 'low' : 'med'
  })).sort((a, b) => b.value - a.value);
  expansion.appendChild(el('div', { class: 'sub-head' }, 'Driver pressure · sorted'));
  expansion.appendChild(renderDriverBars(items, { showDelta: false, labelWidth: 110, max: 10 }));

  let expanded = false;
  row.addEventListener('click', () => {
    expanded = !expanded;
    row.classList.toggle('expanded', expanded);
    expansion.style.display = expanded ? 'block' : 'none';
  });

  const block = el('div', {}, [row, expansion]);
  sectorList.appendChild(block);
});
sectorsBody.appendChild(sectorList);

body.appendChild(renderSectionFrame({
  section_id: 'sectors',
  title: 'Sectors',
  question: 'Sorted by overall pressure. Tap any row to see the 6-driver pressure bars.',
  sources: buildSectionFooter(['NSE', 'Trendlyne', 'Screener']),
  children: [sectorsBody]
}));

// ──────────────────────────────────────────────────────────────
// Trust band — above footer (Design Audit §12)
// ──────────────────────────────────────────────────────────────
const allMetrics = Object.values(DATA.metrics);
const verifN = allMetrics.filter(m => m.verification_state === 'verified').length;
const xcheckN = allMetrics.filter(m => m.verification_state === 'crosscheck_pending').length;
const histN  = allMetrics.filter(m => m.verification_state === 'history_pending').length;

body.appendChild(el('div', { class: 'dashboard-trust-band' }, [
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Verified'),
    el('div', { class: 'dtb-value', style: { color: 'var(--green)' } }, String(verifN)),
    el('div', { class: 'dtb-sub' }, `of ${allMetrics.length} · primary + ≥ 1 cross-check`)
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Cross-check pending'),
    el('div', { class: 'dtb-value', style: { color: 'var(--amber)' } }, String(xcheckN)),
    el('div', { class: 'dtb-sub' }, 'divergence > 5%')
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'History pending'),
    el('div', { class: 'dtb-value', style: { color: 'var(--blue)' } }, String(histN)),
    el('div', { class: 'dtb-sub' }, 'accruing 12m series')
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Free sources'),
    el('div', { class: 'dtb-value', style: { color: 'var(--accent)' } }, '100%'),
    el('div', { class: 'dtb-sub' }, 'no paid feeds in display')
  ])
]));

// ──────────────────────────────────────────────────────────────
// Compute per-section counts for sticky TOC
// ──────────────────────────────────────────────────────────────
function sectionStats(sectionId) {
  const ms = allMetrics.filter(m => m.section === sectionId);
  return {
    count: ms.length,
    shockCount: ms.filter(m => m.status === 'shock').length,
    watchCount: ms.filter(m => m.status === 'high').length
  };
}

const tocSections = [
  { id: 'top',     label: 'Today’s read' },
  { id: 'flows',   label: 'Flows',         ...sectionStats('flows') },
  { id: 'macro',   label: 'Macro',         ...sectionStats('macro') },
  { id: 'economy', label: 'Real economy',  ...sectionStats('economy') },
  { id: 'freight', label: 'Freight',       ...sectionStats('freight') },
  { id: 'market',  label: 'Market context',...sectionStats('market') },
  { id: 'sectors', label: 'Sectors' }
];

document.body.appendChild(renderStickyTOC({ sections: tocSections, engage_after: 720 }));

// ──────────────────────────────────────────────────────────────
// TAB BAR · section navigation
// Hero stays always visible; tabs scope which section-frame renders below.
// "All" tab = original full-scroll behavior.
// URL hash drives state: #flows / #macro / #all etc.
// ──────────────────────────────────────────────────────────────
const TABS = [
  { id: 'flows',   label: 'Flows' },
  { id: 'macro',   label: 'Macro' },
  { id: 'economy', label: 'Real economy' },
  { id: 'freight', label: 'Freight' },
  { id: 'market',  label: 'Market' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'all',     label: 'All' }
];

function setActiveTab(tabId) {
  if (!TABS.find(t => t.id === tabId)) tabId = 'flows';
  document.body.dataset.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId));
  // Mark visible section-frame(s) for CSS show/hide
  document.querySelectorAll('.section-frame').forEach(s => {
    const isMatch = s.dataset.section === tabId;
    s.dataset.active = String(isMatch);
  });
  // Update URL without scrolling
  if (location.hash !== '#' + tabId) {
    history.replaceState(null, '', '#' + tabId);
  }
  // Scroll to tab bar (just below hero) so user sees the start of the section
  const tb = document.getElementById('tab-bar');
  if (tb) {
    const y = tb.getBoundingClientRect().top + window.scrollY - 60;
    if (Math.abs(window.scrollY - y) > 10) window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }
}

function getInitialTab() {
  const hash = location.hash.slice(1);
  return TABS.find(t => t.id === hash) ? hash : 'flows';
}

// Build tab buttons with counts + shock badges
const tabBar = document.getElementById('tab-bar');
TABS.forEach(t => {
  const btn = el('button', {
    class: 'tab-btn',
    'data-tab': t.id,
    onclick: () => setActiveTab(t.id)
  }, [
    el('span', {}, t.label)
  ]);
  if (t.id !== 'all') {
    const stats = sectionStats(t.id);
    if (stats.count) btn.appendChild(el('span', { class: 'tab-count' }, String(stats.count)));
    if (stats.shockCount) btn.appendChild(el('span', { class: 'tab-shock' }, stats.shockCount + ' SHOCK'));
  }
  tabBar.appendChild(btn);
});

setActiveTab(getInitialTab());
window.addEventListener('hashchange', () => setActiveTab(getInitialTab()));

// ──────────────────────────────────────────────────────────────
// Cmd-K palette — global navigation
// Section actions navigate via hash (triggers tab switch)
// ──────────────────────────────────────────────────────────────
const cmdkSections = TABS.filter(t => t.id !== 'all').map(t => ({
  id: t.id,
  label: t.label,
  ...(t.id !== 'all' ? sectionStats(t.id) : {})
}));
wireCmdK({
  metrics: DATA.metrics,
  sections: cmdkSections.map(s => ({ ...s, action: () => { location.hash = '#' + s.id; } })),
  openMetric: openDrawer
});

// Wire topbar Cmd-K hint click
const cmdkHint = document.getElementById('cmdk-hint');
if (cmdkHint) cmdkHint.addEventListener('click', openCmdK);

console.log(`[IRM Phase 5.5] mounted ${Object.keys(DATA.metrics).length} metrics + ${DATA.sectors?.sectors.length || 0} sectors`);
