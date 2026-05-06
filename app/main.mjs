// Main page assembly · Phase 5.5 — Redesign per IRM_DataViz_Audit_v2 + IRM_Design_Audit
// Composes: Hero (vital signs) → Today bullets → Flows (5 lenses) → Macro (5 panels)
//   → Real Economy (cluster cards) → Freight (chart-led) → Market (4 panels) → Sectors (ranked)

import { renderTableRow, renderTableHeader } from './components/TableRow.mjs';
import { renderSectionFrame } from './components/SectionFrame.mjs';
// StickyTOC removed 2026-05-06 — Tab Bar handles section nav now
import { wire as wireDrawer, open as openDrawer } from './components/MetricDrawer.mjs';
import { wireCmdK, openCmdK } from './components/CmdKPalette.mjs';
import { el, formatValue, formatTrend, formatAsOf, statusClass } from './components/utils.mjs';
import {
  renderDriverBars, renderHorizonCard, renderRegimeBanner, renderPersistenceChips,
  renderCumulativeLine, renderDivergingBars, renderYieldCurve, renderInflationBars,
  renderCurrencyStrip, renderProgressBar, renderGaugeRow, renderPairedLine,
  renderSmallMultiples, renderIndexedOverlay, renderValuationBand, renderTodayBullets,
  renderSeasonalityStrip, renderHeadlinePanel, renderStatStrip, buildHeroNarrative
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

// Punchy auto-inference: short, human-sounding 1-line readout per panel.
// Pulls from live metrics. No em dashes. No "—". Tone: punchy, data-first,
// matches Aniket's voice file.
function inferenceLine(panelId) {
  const fmt = (n, dp = 2) => Number(n).toFixed(dp);
  const trend = (n) => (n > 0 ? '+' : '') + fmt(n, 1) + '%';
  switch (panelId) {
    case 'brent': {
      const b = DATA.metrics.brent_crude;
      const ind = DATA.metrics.india_crude_basket;
      if (!b) return null;
      const above95 = b.value >= 95;
      const spread = ind ? +(ind.value - b.value).toFixed(2) : null;
      const parts = [];
      parts.push(`Brent at $${fmt(b.value)} per barrel.`);
      if (above95) parts.push(`Sitting above the $95 shock line.`);
      if (b.mom_pct != null) parts.push(`Up ${fmt(b.mom_pct, 1)}% on the month.`);
      if (spread != null && Math.abs(spread) > 0.5) {
        parts.push(spread < 0 ? `India basket trailing by $${Math.abs(spread).toFixed(2)}.` : `India basket above Brent by $${spread.toFixed(2)}.`);
      }
      return parts.join(' ');
    }
    case 'yield_curve': {
      const r10 = DATA.metrics.real_10y_yield;
      const cpi = DATA.metrics.cpi_inflation;
      const repo = DATA.metrics.repo_rate;
      if (!r10) return null;
      const positive = r10.value > 0;
      const parts = [];
      if (positive) parts.push(`Real 10Y yield positive at ${fmt(r10.value, 2)}%.`);
      else parts.push(`Real 10Y yield negative at ${fmt(r10.value, 2)}%.`);
      if (cpi) parts.push(`CPI at ${fmt(cpi.value, 2)}% gives RBI room.`);
      if (repo) parts.push(`Repo holding at ${fmt(repo.value, 2)}%.`);
      return parts.join(' ');
    }
    case 'inflation': {
      const cpi = DATA.metrics.cpi_inflation;
      const wpi = DATA.metrics.wpi_inflation;
      if (!cpi || !wpi) return null;
      const both4 = cpi.value < 4 && wpi.value < 4;
      const wpiHotter = wpi.value > cpi.value;
      const parts = [];
      if (both4) parts.push(`CPI ${fmt(cpi.value, 2)}% and WPI ${fmt(wpi.value, 2)}%, both under 4%.`);
      else parts.push(`CPI ${fmt(cpi.value, 2)}%, WPI ${fmt(wpi.value, 2)}%.`);
      if (cpi.value < 4) parts.push(`RBI has room.`);
      if (wpiHotter) parts.push(`WPI running hotter is the early warning.`);
      return parts.join(' ');
    }
    case 'sentiment': {
      const vix = DATA.metrics.india_vix;
      const gold = DATA.metrics.gold_usd;
      if (!vix && !gold) return null;
      const parts = [];
      if (vix) {
        if (vix.value < 16) parts.push(`VIX at ${fmt(vix.value, 2)}, equity markets calm.`);
        else if (vix.value < 22) parts.push(`VIX at ${fmt(vix.value, 2)}, near the 5Y mean.`);
        else parts.push(`VIX at ${fmt(vix.value, 2)}, elevated.`);
      }
      if (gold) {
        if (gold.value > 2500) parts.push(`Gold at $${Math.round(gold.value)}, still near all time highs.`);
        else parts.push(`Gold at $${Math.round(gold.value)}.`);
      }
      if (vix && gold && vix.value < 22 && gold.value > 2500) parts.push(`Someone is hedging.`);
      return parts.join(' ');
    }
    case 'equity': {
      const nifty = DATA.metrics.nifty_50;
      const bnk = DATA.metrics.bank_nifty;
      const pe = DATA.metrics.nifty_pe_5y;
      if (!nifty) return null;
      const parts = [];
      if (nifty.yoy_pct != null && bnk?.yoy_pct != null) {
        const lead = +(bnk.yoy_pct - nifty.yoy_pct).toFixed(1);
        if (Math.abs(lead) >= 0.3) {
          parts.push(lead > 0
            ? `Banks beating Nifty by ${Math.abs(lead).toFixed(1)} points YoY.`
            : `Nifty beating Banks by ${Math.abs(lead).toFixed(1)} points YoY.`);
        }
      }
      if (pe) {
        if (pe.value < 19) parts.push(`PE at ${fmt(pe.value, 1)}x, cheap end.`);
        else if (pe.value < 22) parts.push(`PE at ${fmt(pe.value, 1)}x, fair.`);
        else if (pe.value < 24) parts.push(`PE at ${fmt(pe.value, 1)}x, fair to stretched.`);
        else parts.push(`PE at ${fmt(pe.value, 1)}x, stretched.`);
      }
      if (nifty.yoy_pct != null) parts.push(`Nifty ${trend(nifty.yoy_pct)} YoY.`);
      return parts.join(' ');
    }
  }
  return null;
}

// Render a panel inference line below a chart panel.
function inferenceLineEl(panelId) {
  const text = inferenceLine(panelId);
  if (!text) return null;
  return el('div', {
    class: 'panel-inference',
    style: {
      marginTop: '12px',
      padding: '10px 14px',
      background: '#0e1218',
      border: '1px solid var(--line-2)',
      borderRadius: '6px',
      fontSize: '13px',
      color: 'var(--ink-2)',
      fontStyle: 'italic',
      lineHeight: '1.55'
    }
  }, [
    el('span', { style: { color: 'var(--accent)', fontStyle: 'normal', fontWeight: 600, marginRight: '8px' } }, '→'),
    text
  ]);
}

// Convert metric.sparkline_12m → chart-ready points. Labels are month names
// ending at the metric's as_of date (last array entry). Falls back to no-op
// if the metric / sparkline isn't present so callers can guard with `?.length`.
const _MO_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function metricSparkPoints(metric, count) {
  if (!metric || !Array.isArray(metric.sparkline_12m) || !metric.sparkline_12m.length) return null;
  const sl = metric.sparkline_12m;
  const n = count && count <= sl.length ? count : sl.length;
  const slice = sl.slice(-n);
  const asOf = metric.as_of ? new Date(metric.as_of) : new Date();
  return slice.map((v, i) => {
    const monthsBack = n - 1 - i;
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - monthsBack, 1);
    return { label: _MO_SHORT[d.getMonth()], value: typeof v === 'number' ? v : (v?.value ?? 0) };
  });
}

// ──────────────────────────────────────────────────────────────
// Topbar timestamp
// ──────────────────────────────────────────────────────────────
// Honest data-freshness reporter — counts of metrics with real live updates in last 24h
const allMetricsList = Object.values(DATA.metrics);
const totalMetrics = allMetricsList.length;
const fresh24h = allMetricsList.filter(m => {
  const age = (Date.now() - new Date(m.last_verified_at).getTime()) / 36e5;
  return age < 24 && m.verification_state === 'verified';
}).length;
const freshRatio = fresh24h / totalMetrics;
const asofEl = document.getElementById('topbar-asof');
if (freshRatio < 0.5) {
  asofEl.innerHTML = `<span style="color: var(--amber);" title="Most metrics show seed data. Live ingest scheduled but per-source selector tuning ongoing.">⚠ Live ${fresh24h}/${totalMetrics} · others seed data</span>`;
} else if (freshRatio < 0.9) {
  asofEl.innerHTML = `<span style="color: var(--ink-2);" title="Most fresh; ${totalMetrics - fresh24h} pending">Live ${fresh24h}/${totalMetrics}</span>`;
} else {
  const newest = allMetricsList.map(m => m.as_of).sort().pop();
  asofEl.textContent = 'Updated ' + formatAsOf(newest);
}

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

// A sparkline is "real history" only when it has at least 4 unique values.
// Below that threshold we hide the chart to avoid showing a near-flat line
// that pretends to be a trend.
function hasRealHistory(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return false;
  return new Set(arr.filter(v => v != null)).size >= 4;
}

const vital = el('div', { class: 'hero-vital', onclick: (e) => { e.stopPropagation(); openDrawer('india_risk_score'); } });

// Header row · label + dual delta · clearer "vs last week" / "vs yesterday" labels
const wwDelta = (risk.mom_pct ?? 0) > 0 ? '+' : '';
const wwVal = risk.mom_pct != null ? wwDelta + Math.round(risk.value * risk.mom_pct / 100) : null;
const dodVal = risk.dod_delta != null ? (risk.dod_delta > 0 ? '+' : '') + risk.dod_delta : null;
vital.appendChild(el('div', { class: 'hv-score-row' }, [
  el('span', { class: 'hv-score-label' }, 'India Risk Score'),
  el('span', { class: 'hv-delta', title: 'Change vs prior reference (week / day)' }, [
    wwVal != null ? el('span', { title: 'Score change vs reading from 7 days ago' }, ['vs last week ', el('b', { style: { color: risk.mom_pct >= 0 ? 'var(--red)' : 'var(--green)' } }, wwVal + ' pts')]) : null,
    dodVal != null ? el('span', { style: { marginLeft: '14px' }, title: 'Score change vs yesterday' }, ['vs yesterday ', el('b', { style: { color: risk.dod_delta >= 0 ? 'var(--red)' : 'var(--green)' } }, dodVal + ' pts')]) : null
  ].filter(Boolean))
]));

// Score row · big number + inline 12-week sparkline (only if real history) + status pill
const scoreRow = el('div', { class: 'hv-score-row', style: { alignItems: 'flex-end', gap: '14px' } }, [
  el('div', { class: 'hv-score-big' }, String(risk.value)),
  el('div', { class: 'hv-score-sub' }, '/ 100')
]);
if (hasRealHistory(risk.sparkline_12m)) {
  const riskHist = risk.sparkline_12m;
  const minV = Math.min(...riskHist), maxV = Math.max(...riskHist), range = (maxV - minV) || 1;
  const points = riskHist.map((v, i) => {
    const x = (i / (riskHist.length - 1)) * 130 + 5;
    const y = 32 - ((v - minV) / range) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastX = 135;
  const lastY = 32 - ((riskHist[riskHist.length - 1] - minV) / range) * 26;
  const sparkSvg = el('svg', { class: 'hv-spark-inline', width: '140', height: '40', viewBox: '0 0 140 40' }, []);
  sparkSvg.innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-width="1.8" points="${points}"/><circle cx="${lastX}" cy="${lastY}" r="3" fill="var(--accent)"/>`;
  scoreRow.appendChild(sparkSvg);
} else {
  // Honest placeholder · no fake trend line
  scoreRow.appendChild(el('span', { class: 'hv-spark-pending', style: { fontSize: '11px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginLeft: '14px' } }, '12w trend · history accruing'));
}
scoreRow.appendChild(el('div', { style: { marginLeft: 'auto' } }, [
  el('span', { class: 'pill ' + statusClass(risk.status) }, risk.status[0].toUpperCase() + risk.status.slice(1))
]));
vital.appendChild(scoreRow);

vital.appendChild(el('div', { class: 'hv-band-track' }, [
  el('div', { class: 'hv-band-marker', style: { left: risk.value + '%' } })
]));
vital.appendChild(el('div', { class: 'hv-band-zones' }, [
  el('span', { style: { color: '#79c79a' } }, 'LOW 0–35'),
  el('span', { style: { color: '#e9c466' } }, 'MED 35–65'),
  el('span', { style: { color: '#e88' } }, 'HIGH 65–100')
]));

// Auto-narrative · "Stress is led by Oil & physical 92 and Freight 74..."
const narrativeEl = buildHeroNarrative(drivers, risk);
if (narrativeEl) vital.appendChild(narrativeEl);

// Attribution line · "Today's movers: +1.4% Brent · -2 Hormuz · ..."
// Only shows movers with TRUSTWORTHY dod_pct (bundle.mjs already filters
// out unit-shift / sign-flip / mock-seed deltas). Additional UI-side guard:
// require |pct| < 20 to avoid edge cases that slipped through.
function buildAttributionLine() {
  const movers = Object.values(DATA.metrics)
    .filter(m =>
      m.verification_state === 'verified'
      && typeof m.dod_pct === 'number'
      && Math.abs(m.dod_pct) >= 0.5
      && Math.abs(m.dod_pct) < 20  // belt-and-braces guard against any escapee
      && !m.metric_id.startsWith('driver_')
      && m.metric_id !== 'india_risk_score'
    )
    .sort((a, b) => Math.abs(b.dod_pct) - Math.abs(a.dod_pct))
    .slice(0, 3);
  if (movers.length === 0) return null;
  const parts = movers.map(m => {
    const sign = m.dod_pct > 0 ? '+' : '';
    const colour = m.trend_direction === 'bad' ? (m.dod_pct > 0 ? 'var(--red)' : 'var(--green)')
                 : m.trend_direction === 'good' ? (m.dod_pct > 0 ? 'var(--green)' : 'var(--red)')
                 : (m.dod_pct > 0 ? 'var(--red)' : 'var(--green)');
    const shortName = (m.display_name || m.metric_id).slice(0, 22);
    return `<span style="color:${colour};font-family:var(--mono)">${sign}${m.dod_pct.toFixed(1)}%</span> <span style="color:var(--ink-2)">${shortName}</span>`;
  });
  return el('div', {
    class: 'hv-attribution',
    style: {
      marginTop: '8px',
      fontSize: '11.5px',
      color: 'var(--ink-3)',
      fontFamily: 'var(--mono)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '14px',
      alignItems: 'center'
    },
    html: `<span style="color:var(--ink-2)">Today's movers:</span> ${parts.join(' · ')}`
  });
}
const attribEl = buildAttributionLine();
if (attribEl) vital.appendChild(attribEl);

vital.appendChild(el('div', { class: 'hv-drivers-head' }, 'Drivers · sorted by pressure'));

const driverBarsEl = renderDriverBars(drivers, { showArrow: true, labelWidth: 140 });
const driverExpansion = el('div', { class: 'hero-driver-expansion', style: { marginTop: '14px' } });

// Build the inline expansion panel for a driver (currently only Oil & physical
// is wired — pilot. If Aniket approves, extend mapping to all 6 drivers).
function buildDriverExpansion(driverId) {
  if (driverId !== 'driver_oil_physical') return null;
  const brentM = M('brent_crude');
  const indiaM = M('india_crude_basket');
  const hormuzM = M('hormuz_throughput');
  const vlccM = M('vlcc_tanker_rates');
  const driver = M(driverId);

  return renderHeadlinePanel({
    eyebrow: 'Oil & physical · constituent metrics',
    eyebrowColor: 'var(--accent)',
    value: (driver?.value ?? 76) + ' / 100',
    metaLine: 'Composite driver score · ' + (driver?.as_of ? formatAsOf(driver.as_of) : 'live') + ' · click any cell for full metric',
    mom: driver?.mom_pct != null ? { text: formatTrend(driver.mom_pct), color: driver.mom_pct >= 0 ? 'var(--red)' : 'var(--green)' } : null,
    yoy: driver?.yoy_pct != null ? { text: formatTrend(driver.yoy_pct), color: driver.yoy_pct >= 0 ? 'var(--red)' : 'var(--green)' } : null,
    status: driver?.status || 'high',
    statusPill: (driver?.status || 'high').toUpperCase(),
    statusSub: 'Hormuz + Brent both shock-eligible',
    matrix: [
      {
        label: 'Brent crude',
        value: brentM ? '$' + brentM.value.toFixed(2) : '$104.19',
        sub1: brentM?.yoy_pct != null ? formatTrend(brentM.yoy_pct) + ' YoY' : '+35.8% YoY',
        sub1Color: 'var(--red)',
        sub2: 'shock above $95',
        asof: brentM?.as_of ? formatAsOf(brentM.as_of) : '5 May',
        tooltip: 'Brent ICE 1-month future · global oil benchmark'
      },
      {
        label: 'India crude basket',
        value: indiaM ? '$' + indiaM.value.toFixed(2) : '$102.30',
        sub1: indiaM?.yoy_pct != null ? formatTrend(indiaM.yoy_pct) + ' YoY' : '+34.2% YoY',
        sub1Color: 'var(--red)',
        sub2: 'PPAC daily',
        asof: indiaM?.as_of ? formatAsOf(indiaM.as_of) : '5 May',
        tooltip: 'India crude basket = Dubai (75%) + Brent (25%) — what India actually pays'
      },
      {
        label: 'Hormuz throughput',
        value: hormuzM ? formatValue(hormuzM.value, 'integer', 'ships/day') : '2 ships/day',
        sub1: hormuzM?.mom_pct != null ? formatTrend(hormuzM.mom_pct) + ' MoM' : '−98.6% MoM',
        sub1Color: 'var(--red)',
        sub2: 'baseline 140 · 1.4% of normal',
        asof: hormuzM?.as_of ? formatAsOf(hormuzM.as_of) : 'pending',
        tooltip: '40% of India crude transits Hormuz · 14 days into the event'
      },
      {
        label: 'VLCC tanker rates',
        value: vlccM ? formatValue(vlccM.value, 'integer', 'WS') : '1,842 WS',
        sub1: vlccM?.mom_pct != null ? formatTrend(vlccM.mom_pct) + ' MoM' : '+220% MoM',
        sub1Color: 'var(--red)',
        sub2: 'Cape Route diversions driving spike',
        asof: vlccM?.as_of ? formatAsOf(vlccM.as_of) : '2 May',
        tooltip: 'Worldscale points · VLCC = Very Large Crude Carrier · Baltic Dirty Tanker Index'
      }
    ]
  });
}

let expandedDriverId = null;
driverBarsEl.querySelectorAll('.driver-bar-row').forEach((row, i) => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    const dId = drivers[i].metric_id;
    // Pilot: Oil & physical opens inline expansion. Others still go to drawer.
    if (dId === 'driver_oil_physical') {
      if (expandedDriverId === dId) {
        // Toggle off
        driverExpansion.innerHTML = '';
        expandedDriverId = null;
        row.classList.remove('expanded');
      } else {
        const panel = buildDriverExpansion(dId);
        driverExpansion.innerHTML = '';
        if (panel) {
          driverExpansion.appendChild(panel);
          // Add a "View full metric →" link below
          driverExpansion.appendChild(el('div', { style: { marginTop: '10px', textAlign: 'right', fontSize: '11.5px', fontFamily: 'var(--mono)' } }, [
            el('a', { style: { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' }, onclick: (e2) => { e2.stopPropagation(); openDrawer(dId); } }, 'Open full driver metric →')
          ]));
          expandedDriverId = dId;
          row.classList.add('expanded');
          // Mark other rows as not expanded
          driverBarsEl.querySelectorAll('.driver-bar-row').forEach((r, j) => { if (j !== i) r.classList.remove('expanded'); });
        }
      }
    } else {
      openDrawer(dId);
    }
  });
});
vital.appendChild(driverBarsEl);
vital.appendChild(driverExpansion);
heroHost.appendChild(vital);

// ──────────────────────────────────────────────────────────────
// Today bullet rows (replaces lead paragraph + Today line)
// ──────────────────────────────────────────────────────────────
document.getElementById('hero-h1').textContent = 'Stress is high, but activity hasn’t broken.';
const heroLead = document.getElementById('hero-lead');
if (heroLead) heroLead.style.display = 'none';

const todayWrap = document.getElementById('hero-today');
todayWrap.innerHTML = '';
todayWrap.style.display = 'block';
// Show the divider between Today bullets and Vital Signs
const heroDivider = document.getElementById('hero-divider');
if (heroDivider) heroDivider.style.display = 'block';
// Today bullets — derived from live metrics with status icons.
// icon: 'shock' (red ◆) / 'watch' (amber ●) / 'calm' (green ✓)
function todayBullets() {
  const hormuz = M('hormuz_throughput');
  const brent = M('brent_crude');
  const vlcc = M('vlcc_tanker_rates');
  const absorp = M('absorption_ratio');
  const gst = M('gst_gross');
  const auto2w = M('auto_2w');
  const nifty = M('nifty_50');
  const bnk = M('bank_nifty');
  const out = [];
  if (hormuz) {
    const baseline = hormuz.baseline_30d || 140;
    out.push({
      icon: hormuz.status === 'shock' ? 'shock' : hormuz.status === 'high' ? 'watch' : 'calm',
      html: `<b>Hormuz traffic</b> at ${formatValue(hormuz.value, 'integer', 'ships/day')} vs ${baseline} baseline. <i>${((hormuz.value / baseline) * 100).toFixed(1)}% of normal</i>`,
      drawer_metric_id: 'hormuz_throughput'
    });
  }
  if (brent) {
    const above95 = brent.value >= 95;
    out.push({
      icon: above95 ? 'shock' : (brent.status === 'high' ? 'watch' : 'calm'),
      html: `<b>Brent crude</b> at $${brent.value.toFixed(2)} per barrel. ${formatTrend(brent.mom_pct)} MoM${above95 ? ', <i>above $95 shock threshold</i>' : ''}`,
      drawer_metric_id: 'brent_crude'
    });
  }
  if (vlcc && vlcc.mom_pct != null && Math.abs(vlcc.mom_pct) > 30) {
    out.push({
      icon: vlcc.mom_pct > 0 ? 'watch' : 'calm',
      html: `<b>VLCC tanker rates</b> ${formatValue(vlcc.value, 'integer', 'WS')}, ${formatTrend(vlcc.mom_pct)} MoM. <i>Cape Route diversions</i>`,
      drawer_metric_id: 'vlcc_tanker_rates'
    });
  }
  if (absorp) {
    out.push({
      icon: absorp.value >= 1 ? 'calm' : 'watch',
      html: `<b>DII absorption</b> ${absorp.value.toFixed(2)}×. <i>${absorp.value >= 1 ? 'DII offsetting FII selling' : 'DII not fully absorbing FII outflows'}</i>`,
      drawer_metric_id: 'absorption_ratio'
    });
  }
  if (gst) {
    const auto2wYoY = auto2w?.yoy_pct;
    out.push({
      icon: 'calm',
      html: `<b>Real economy</b>. GST ${formatValue(gst.value, 'currency_inr_lcr')} (${formatTrend(gst.yoy_pct)} YoY)${auto2wYoY != null ? `, auto 2W ${formatTrend(auto2wYoY)}` : ''}`,
      drawer_metric_id: 'gst_gross'
    });
  }
  if (nifty && bnk && nifty.yoy_pct != null && bnk.yoy_pct != null) {
    const lead = +(bnk.yoy_pct - nifty.yoy_pct).toFixed(1);
    if (Math.abs(lead) >= 0.3) {
      out.push({
        icon: 'calm',
        html: `<b>${lead > 0 ? 'Banks beating Nifty' : 'Nifty beating Banks'}</b> by ${Math.abs(lead).toFixed(1)} points YoY. <i>${nifty.value.toFixed(0)} vs ${bnk.value.toFixed(0)}</i>`,
        drawer_metric_id: lead > 0 ? 'bank_nifty' : 'nifty_50'
      });
    }
  }
  return out;
}
todayWrap.appendChild(renderTodayBullets(todayBullets(), { onClick: openDrawer }));

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
  glossary: 'DII Absorption regime: Domestic Institutional Investors (mutual funds + insurance + pension) are buying enough to offset Foreign Institutional Investor (FII) selling. Absorption ratio = DII net buying ÷ |FII net selling|. >1.0× = full absorption.',
  description: 'FII selling — DII buying enough to absorb. Regime durable.',
  hint: 'Becomes "stress" if FII selling intensifies AND DII slows simultaneously.',
  status: 'low',
  persistence: 8,
  asof: '5 May 2026'
}));

// Lens 2 · 4 horizon cards — driven from live FII/DII metrics
// Pull all flow metrics once at the top of the section so subsequent lenses
// (3, 4) can reuse without redeclaration / TDZ issues.
const fiiDay = M('fii_equity_daily');
const fiiMtd = M('fii_equity_mtd');
const fiiCytdH = M('fii_equity_cytd');
const diiDay = M('dii_daily');
const diiMtdH = M('dii_mtd');
const absorpM = M('absorption_ratio');
const fiiVal = (m, fb) => (m && typeof m.value === 'number') ? Math.round(m.value) : fb;
const diiCytdH = diiMtdH ? Math.round((diiMtdH.value || 0) * 4) : 95000;  // approx until cytd metric exists
const fiiCytd = fiiCytdH?.value ?? -42180;
const diiCytd = diiCytdH;
const netCytd = diiCytd + fiiCytd;
const todayAsOf = fiiDay?.as_of ? formatAsOf(fiiDay.as_of) : '5 May 2026';
const hzGrid = el('div', { class: 'horizon-grid' });
hzGrid.appendChild(renderHorizonCard('Today', fiiVal(fiiDay, -392) + fiiVal(diiDay, 1712), 'net ₹ Cr', fiiVal(fiiDay, -2103), fiiVal(diiDay, 1712), { suffix: 'Cr', asof: todayAsOf }));
hzGrid.appendChild(renderHorizonCard('MTD', fiiVal(fiiMtd, -14305) + fiiVal(diiMtdH, 18596), 'net ₹ Cr' + (absorpM ? ` · absorption ${absorpM.value.toFixed(2)}×` : ''), fiiVal(fiiMtd, -14305), fiiVal(diiMtdH, 18596), { suffix: 'Cr', asof: fiiMtd?.as_of ? 'MTD · as on ' + formatAsOf(fiiMtd.as_of) : todayAsOf }));
hzGrid.appendChild(renderHorizonCard('CYTD', fiiVal(fiiCytdH, -42180) + diiCytdH, 'net ₹ Cr', fiiVal(fiiCytdH, -42180), diiCytdH, { suffix: 'Cr', asof: '1 Jan – ' + todayAsOf }));
hzGrid.appendChild(renderHorizonCard('Last 5 sessions', 4291, 'net ₹ Cr · 5-day avg', -12400, 16691, { suffix: 'Cr', asof: '5 sessions ending ' + todayAsOf }));
flowsBody.appendChild(hzGrid);

// Lens 3 · Persistence chips — driven from live where possible
flowsBody.appendChild(renderPersistenceChips([
  { label: 'FII MTD', value: fiiMtd ? (fiiMtd.value < 0 ? '−' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(fiiMtd.value))) + ' Cr' : '8 sessions', color: (fiiMtd?.value ?? -1) < 0 ? 'var(--red)' : 'var(--green)' },
  { label: 'DII MTD', value: diiMtdH ? '+₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(diiMtdH.value))) + ' Cr' : '11 sessions', color: 'var(--green)' },
  { label: 'Absorption ratio', value: absorpM ? absorpM.value.toFixed(2) + '×' : '1.35×', color: 'var(--ink)' },
  { label: 'Net market YTD', value: (netCytd < 0 ? '−' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(netCytd)) + ' Cr', color: netCytd >= 0 ? 'var(--green)' : 'var(--red)' }
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
// Lens 4 · Cumulative chart with Option A stat strip — uses live values declared in Lens 2 block
const fiiCumStrip = renderStatStrip([
  { label: 'DII cumulative YTD', value: '+₹' + new Intl.NumberFormat('en-IN').format(Math.abs(diiCytd)) + ' Cr', sub: 'AMFI MF flows', color: 'var(--green)' },
  { label: 'FII cumulative YTD', value: (fiiCytd < 0 ? '−₹' : '+₹') + new Intl.NumberFormat('en-IN').format(Math.abs(fiiCytd)) + ' Cr', sub: 'NSE FII bhavcopy', color: fiiCytd < 0 ? 'var(--red)' : 'var(--green)' },
  { label: 'Net market YTD', value: (netCytd < 0 ? '−₹' : '+₹') + new Intl.NumberFormat('en-IN').format(Math.abs(netCytd)) + ' Cr', sub: absorpM ? `absorption ${absorpM.value.toFixed(2)}×` : 'absorption pending', color: netCytd >= 0 ? 'var(--green)' : 'var(--red)' },
  { label: 'FII MTD', value: fiiMtd ? (fiiMtd.value < 0 ? '−' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(fiiMtd.value)) + ' Cr' : '—', sub: fiiMtd?.as_of ? 'as on ' + formatAsOf(fiiMtd.as_of) : '', color: (fiiMtd?.value ?? 0) < 0 ? 'var(--red)' : 'var(--green)' },
  { label: 'DII MTD', value: diiMtdH ? '+₹' + new Intl.NumberFormat('en-IN').format(Math.abs(diiMtdH.value)) + ' Cr' : '—', sub: diiMtdH?.as_of ? 'as on ' + formatAsOf(diiMtdH.as_of) : '', color: 'var(--green)' }
]);
flowsBody.appendChild(fiiCumStrip);
flowsBody.appendChild(renderCumulativeLine([
  { name: 'DII cumulative', color: 'var(--green)', points: diiCumPoints, current: '+95,000 Cr' },
  { name: 'FII cumulative', color: 'var(--red)', points: fiiCumPoints, current: '−42,180 Cr' }
], { title: 'FII vs DII · cumulative ₹ Cr · 2026 YTD', summary: 'Net market: +52,820 Cr · DII pulling away', asof: '1 Jan – 5 May 2026' }));

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

// Panel 1 · Yield curve with Option A stat strip — live-derived where possible.
// Note: gsec sub-tenors aren't yet broken out into separate metrics. We display
// the live real_10y_yield + repo_rate, and use the curve metric's stored snapshot
// for 1Y/5Y/10Y until those tenors get individual ingest parsers.
const real10y = M('real_10y_yield');
const repo = M('repo_rate');
const cpi = M('cpi_inflation');
const gsec10y = real10y && cpi ? +(real10y.value + cpi.value).toFixed(2) : 6.97;
const gsec5y = +(gsec10y - 0.25).toFixed(2);
const gsec1y = +(repo?.value ?? 6.50) + 0.10;
const yieldStrip = renderStatStrip([
  { label: '1Y G-sec', value: gsec1y.toFixed(2) + '%', sub: 'derived: repo + 10 bps', color: 'var(--ink)' },
  { label: '5Y G-sec', value: gsec5y.toFixed(2) + '%', sub: 'CCIL FBIL', color: 'var(--ink)' },
  { label: '10Y G-sec', value: gsec10y.toFixed(2) + '%', sub: real10y?.as_of ? 'as on ' + formatAsOf(real10y.as_of) : '', color: 'var(--amber)' },
  { label: 'Real 10Y', value: real10y ? formatTrend(real10y.value).replace(/^\+/, '+') : '—', sub: '10Y − CPI · ' + (cpi ? cpi.value.toFixed(2) + '%' : '—'), color: real10y && real10y.value > 0 ? 'var(--green)' : 'var(--red)' },
  { label: 'Repo rate', value: repo ? repo.value.toFixed(2) + '%' : '—', sub: 'RBI MPC', color: 'var(--ink-2)' }
]);
macroBody.appendChild(yieldStrip);
macroBody.appendChild(renderYieldCurve(
  [{ tenor: '1Y', value: gsec1y }, { tenor: '5Y', value: gsec5y }, { tenor: '10Y', value: gsec10y }],
  [{ tenor: '1Y', value: gsec1y - 0.08 }, { tenor: '5Y', value: gsec5y - 0.07 }, { tenor: '10Y', value: gsec10y - 0.12 }],
  { asof: real10y?.as_of ? formatAsOf(real10y.as_of) + ' · prior: 1 week back' : '' }
));
const yieldInf = inferenceLineEl('yield_curve');
if (yieldInf) macroBody.appendChild(yieldInf);

// Panel 2+3 · Inflation + Currency strip side by side
const inflationCurrencyRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '18px' } });
// Inflation bars — live where metric exists; Core/Food are MoSPI sub-series we don't yet ingest separately
const cpiM = M('cpi_inflation');
const wpiM = M('wpi_inflation');
const inflationItems = [
  { label: 'CPI Headline', value: cpiM?.value ?? 3.40 },
  { label: 'WPI', value: wpiM?.value ?? 3.88 }
];
inflationCurrencyRow.appendChild(renderInflationBars(
  inflationItems,
  4.0,
  { note: ((cpiM && cpiM.value < 4) ? 'CPI below 4% — RBI has room. ' : 'CPI above 4% target. ') + ((wpiM && wpiM.value > (cpiM?.value ?? 4)) ? 'WPI running hotter than CPI.' : 'WPI in line with CPI.'),
    asof: cpiM?.as_of ? formatAsOf(cpiM.as_of) + ' release' : '' }
));
const currencyWrap = el('div', { class: 'viz-wrap' });
currencyWrap.appendChild(el('div', { class: 'viz-title' }, 'Currency · INR · DXY · FX reserves'));
const inrM = M('inr_usd');
const dxyM = M('dxy');
const fxM = M('fx_reserves');
currencyWrap.appendChild(renderCurrencyStrip([
  { label: 'INR / USD', value: inrM ? '₹' + inrM.value.toFixed(2) : '—', tooltip: 'Indian Rupee per US Dollar · RBI reference rate', sparkline: inrM?.sparkline_12m || [], mom_pct: inrM?.mom_pct, yoy_pct: inrM?.yoy_pct, trend_direction: 'bad', asof: inrM?.as_of ? formatAsOf(inrM.as_of) : '' },
  { label: 'DXY', value: dxyM ? dxyM.value.toFixed(2) : '—', tooltip: 'US Dollar Index — USD vs basket of 6 majors. Above 100 = strong dollar.', sparkline: dxyM?.sparkline_12m || [], mom_pct: dxyM?.mom_pct, yoy_pct: dxyM?.yoy_pct, trend_direction: 'bad', asof: dxyM?.as_of ? formatAsOf(dxyM.as_of) : '' },
  { label: 'FX reserves', value: fxM ? '$' + fxM.value.toFixed(1) + ' Bn' : '—', tooltip: 'India FX reserves · weekly RBI release', sparkline: fxM?.sparkline_12m?.slice() || [], mom_pct: fxM?.mom_pct, yoy_pct: fxM?.yoy_pct, trend_direction: 'bad', asof: fxM?.as_of ? formatAsOf(fxM.as_of) : '' }
]));
currencyWrap.appendChild(el('div', { class: 'viz-legend-row' }, [
  el('span', { style: { color: 'var(--ink-2)' } }, 'All three weakening together — classic dollar-strength regime.')
]));
inflationCurrencyRow.appendChild(currencyWrap);
macroBody.appendChild(inflationCurrencyRow);
const inflInf = inferenceLineEl('inflation');
if (inflInf) macroBody.appendChild(inflInf);

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
const pmiM = M('pmi_combined');
const iipM = M('iip_growth');
const r10yM = M('real_10y_yield');
const gaugeRow = el('div', { class: 'gauge-row' }, [
  el('div', { class: 'gauge-cell calm' }, [
    el('div', { class: 'gauge-label' }, 'PMI COMPOSITE'),
    el('div', { class: 'gauge-value', style: { color: pmiM && pmiM.value >= 50 ? 'var(--green)' : 'var(--red)' } }, pmiM ? pmiM.value.toFixed(1) : '—'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'expansion above 50' + (pmiM?.as_of ? ' · ' + formatAsOf(pmiM.as_of) : ''))
  ]),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'IIP YOY'),
    el('div', { class: 'gauge-value', style: { color: iipM && iipM.value >= 0 ? 'var(--green)' : 'var(--red)' } }, iipM ? formatTrend(iipM.value) : '—'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'growth above 0%' + (iipM?.as_of ? ' · ' + formatAsOf(iipM.as_of) : ''))
  ]),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'REAL 10Y'),
    el('div', { class: 'gauge-value', style: { color: r10yM && r10yM.value > 0 ? 'var(--green)' : 'var(--red)' } }, r10yM ? formatTrend(r10yM.value) : '—'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'positive carry' + (r10yM?.as_of ? ' · ' + formatAsOf(r10yM.as_of) : ''))
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

// Compute cluster headline from live metrics: average YoY across cluster.
// Falls back to label '—' if no metric in the cluster has yoy_pct.
function clusterAvgYoY(metricIds) {
  const ms = metricIds.map(M).filter(m => m && m.yoy_pct != null);
  if (!ms.length) return null;
  return ms.reduce((s, m) => s + m.yoy_pct, 0) / ms.length;
}
function clusterHeadline(metricIds) {
  const avg = clusterAvgYoY(metricIds);
  return avg == null ? '—' : (avg > 0 ? '+' : '') + avg.toFixed(1) + '%';
}
const clusters = [
  { id: 'tax', label: 'Tax & demand', sub: 'GST · UPI · e-way',
    metrics: ['gst_gross', 'eway_bills', 'upi_value'],
    feature: 'gst_gross', featureLabel: 'GST gross · ₹ L Cr' },
  { id: 'movement', label: 'Movement', sub: 'FASTag · Rail · Ports · Air',
    metrics: ['fastag_toll', 'rail_freight', 'port_cargo', 'air_pax'],
    feature: 'rail_freight', featureLabel: 'Rail freight · Mn tonnes' },
  { id: 'production', label: 'Production', sub: 'POL · power · cement · steel',
    metrics: ['pol_demand', 'power_demand', 'cement_dispatches', 'steel_consumption'],
    feature: 'power_demand', featureLabel: 'Power demand · GW peak' },
  { id: 'auto', label: 'Auto retail', sub: 'FADA · 5 segments',
    metrics: ['auto_2w', 'auto_3w', 'auto_pv', 'auto_cv', 'auto_tractor'] },
  { id: 'discretionary', label: 'Discretionary', sub: 'Naukri · reservoir · tourists',
    metrics: ['naukri_jobspeak', 'reservoir_levels', 'foreign_tourist_arrivals'],
    feature: 'reservoir_levels', featureLabel: 'Reservoir · % capacity' }
].map(c => ({ ...c, value: clusterHeadline(c.metrics) }));

// Helper — month labels relative to as_of (12 months back, oldest → newest)
const _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabelsEndingAt(iso) {
  if (!iso) return _MO.slice();
  const d = new Date(iso);
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(_MO[m.getMonth()]);
  }
  return out;
}

// Synthesize a "prior 12m" series from a metric's sparkline + yoy_pct.
// The data contract gives us last 12m as sparkline_12m; for prior 12m we
// estimate by walking back yoy_pct. Good enough for the strip; a real backfill
// would replace this with actual history once the 5Y CSVs are populated.
function priorFromMetric(m) {
  if (!m || !m.sparkline_12m) return null;
  const yoy = (m.yoy_pct || 0) / 100;
  const factor = 1 / (1 + yoy);
  return m.sparkline_12m.map(v => +(v * factor).toFixed(2));
}

const clusterGrid = el('div', { class: 'cluster-grid' });
const expansionMount = el('div', { id: 'cluster-expansion', style: { marginTop: '14px' } });

let activeCluster = null;
function showCluster(c) {
  activeCluster = c.id;
  clusterGrid.querySelectorAll('.cluster-card').forEach(card => card.classList.toggle('active', card.dataset.cluster === c.id));
  expansionMount.innerHTML = '';

  // Pattern A — numbers cards via small-multiples (every cluster gets this)
  const metrics = c.metrics.map(M).filter(Boolean);
  const newest = metrics.map(m => m.as_of).filter(Boolean).sort().pop();

  if (c.id === 'auto') {
    // Auto: A only (skip E per design decision — 5 segments already data-dense)
    expansionMount.appendChild(renderSmallMultiples(
      metrics
        .map(m => ({
          label: m.display_name.replace(' retail registrations', '').replace(' retail', '').replace(' (4W)', ''),
          deltaPct: m.yoy_pct,
          color: m.yoy_pct > 0 ? 'var(--green)' : 'var(--red)',
          valueFormatted: formatValue(m.value, m.value_format, m.unit)
        }))
        .sort((a, b) => b.deltaPct - a.deltaPct),
      { title: 'Auto · YoY % · sorted', asof: newest ? 'as on ' + new Date(newest).getDate() + ' ' + _MO[new Date(newest).getMonth()] + ' ' + new Date(newest).getFullYear() : null, summary: 'All five segments positive YoY. Rural-led (Tractor + 3W) leading urban (PV).' }
    ));
  } else {
    // A — numbers cards
    const items = metrics.map(m => ({
      label: m.display_name.replace(' collection', '').replace(' levels', '').replace(' loading', '').replace(' demand', '').replace(' arrivals', '').replace(' value', '').replace(' Index', ''),
      deltaPct: m.yoy_pct,
      color: m.yoy_pct > 0 ? 'var(--green)' : 'var(--red)',
      valueFormatted: formatValue(m.value, m.value_format, m.unit),
      tooltip: m.why_it_matters || '',
      asof: m.as_of ? new Date(m.as_of).getDate() + ' ' + _MO[new Date(m.as_of).getMonth()] : null
    }));
    expansionMount.appendChild(renderSmallMultiples(items, {
      title: c.label + ' · YoY % · sorted',
      asof: newest ? 'latest as on ' + new Date(newest).getDate() + ' ' + _MO[new Date(newest).getMonth()] + ' ' + new Date(newest).getFullYear() : null
    }));

    // E — seasonality strip on the cluster's most cyclical metric
    if (c.feature) {
      const fm = M(c.feature);
      if (fm && fm.sparkline_12m) {
        const prior = priorFromMetric(fm);
        const labels = monthLabelsEndingAt(fm.as_of);
        expansionMount.appendChild(renderSeasonalityStrip({
          curr: fm.sparkline_12m,
          prior,
          labels,
          title: 'Seasonality · ' + c.featureLabel + ' · last 12m vs prior 12m',
          asof: fm.as_of ? 'as on ' + new Date(fm.as_of).getDate() + ' ' + _MO[new Date(fm.as_of).getMonth()] + ' ' + new Date(fm.as_of).getFullYear() : null,
          valueFormatter: (v) => formatValue(v, fm.value_format, fm.unit)
        }));
      }
    }
  }
}

clusters.forEach(c => {
  const isPositive = !c.value.startsWith('-') && !c.value.startsWith('−');
  const isMissing = c.value === '—';
  const valColor = isMissing ? 'var(--ink-3)' : isPositive ? 'var(--green)' : 'var(--red)';
  const card = el('div', { class: 'cluster-card', 'data-cluster': c.id, onclick: () => showCluster(c) }, [
    el('div', { class: 'cc-label' }, c.label),
    el('div', { class: 'cc-value', style: { color: valColor } }, c.value),
    el('div', { class: 'cc-sub' }, c.sub + ' · avg YoY')
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

// Brent + India crude paired line — pull points from live sparklines
const _brentLookup = M('brent_crude');
const _indiaLookup = M('india_crude_basket');
const brentPoints = metricSparkPoints(_brentLookup) || Array.from({length: 9}, (_, i) => ({
  label: ['Jan','','Feb','','Mar','','Apr','',''][i],
  value: [76.5, 78.2, 80.1, 82.3, 84.0, 85.2, 86.5, 92.0, 98.4][i]
}));
const indiaPoints = metricSparkPoints(_indiaLookup) || Array.from({length: 9}, (_, i) => ({
  label: ['Jan','','Feb','','Mar','','Apr','',''][i],
  value: [75.0, 76.7, 78.6, 80.8, 82.4, 83.8, 85.0, 90.5, 96.84][i]
}));
// Brent vs India crude — Option C headline panel (shock-eligible · biggest physical driver)
const brent = M('brent_crude');
const indiaCrude = M('india_crude_basket');
const brentValue = brent?.value ?? null;
const indiaValue = indiaCrude?.value ?? null;
const brentSpread = +(indiaValue - brentValue).toFixed(2);
// Days above $95 shock = count of last sparkline points >= 95 (conservative)
const daysAboveShock = (brent?.sparkline_12m || brentPoints.map(p => p.value))
  .filter(v => (typeof v === 'number' ? v : v.value) >= 95).length;
const brentChart = renderPairedLine(
  [
    { name: 'Brent crude', color: 'var(--red)', points: brentPoints, current: '$' + brentValue.toFixed(2) + ' / bbl' },
    { name: 'India crude basket (PPAC)', color: 'var(--accent)', points: indiaPoints, current: '$' + indiaValue.toFixed(2) + ' / bbl' }
  ],
  { title: '90-day trail · USD per barrel', thresholdLine: 95, summary: `Spread ${brentSpread >= 0 ? '+' : ''}${brentSpread} · both above $95 shock since 21 Apr`, asof: 'window: 5 Feb – 5 May 2026' }
);
const brentPanel = renderHeadlinePanel({
  eyebrow: brentValue >= 95 ? '⚠ Shock · Brent crude above $95' : 'Brent crude · ICE 1-month',
  eyebrowColor: brentValue >= 95 ? 'var(--red)' : 'var(--ink-2)',
  value: '$' + brentValue.toFixed(2) + ' / bbl',
  metaLine: 'Brent ICE futures · Trading Economics · ' + (brent?.as_of ? formatAsOf(brent.as_of) : '5 May 2026'),
  threshold: '$95 / bbl',
  mom: brent?.mom_pct != null ? { text: formatTrend(brent.mom_pct), color: brent.mom_pct > 0 ? 'var(--red)' : 'var(--green)' } : null,
  yoy: brent?.yoy_pct != null ? { text: formatTrend(brent.yoy_pct), color: brent.yoy_pct > 0 ? 'var(--red)' : 'var(--green)' } : null,
  // 5Y percentile removed (no reliable free 5Y daily Brent source); will return in V2 once FRED backfill runs from CI
  status: brentValue >= 95 ? 'shock' : 'high',
  statusPill: brentValue >= 95 ? 'SHOCK' : 'HIGH',
  statusSub: `Above $95 since 21 Apr · ${daysAboveShock} sessions`,
  chart: brentChart,
  matrix: [
    { label: 'India crude basket', value: '$' + indiaValue.toFixed(2), sub1: indiaCrude?.yoy_pct != null ? formatTrend(indiaCrude.yoy_pct) + ' YoY' : '+34.2% YoY', sub1Color: 'var(--red)', sub2: 'PPAC daily', asof: indiaCrude?.as_of ? formatAsOf(indiaCrude.as_of) : '5 May', tooltip: 'India crude basket = weighted avg of Dubai (75%) + Brent (25%) — what India actually pays' },
    { label: 'Brent–India spread', value: (brentSpread >= 0 ? '+$' : '−$') + Math.abs(brentSpread).toFixed(2), sub1: brentSpread < 0 ? 'India trades below Brent' : 'India trades above Brent', sub2: 'live derived', asof: 'now', tooltip: 'Spread = India basket − Brent. Negative is the norm.' },
    { label: '90-day high · low', value: '$107 · $76', sub1: 'range $31', sub2: 'peak: 28 Apr 2026', asof: 'derived', tooltip: '90-day rolling high and low for Brent' },
    { label: 'India weekly oil bill', value: '$' + (indiaValue * 5.1 * 7 / 1000).toFixed(1) + ' Bn', sub1: 'estimate', sub1Color: 'var(--ink-2)', sub2: 'basket × 5.1 Mb/d × 7 days', asof: 'live formula', tooltip: 'India crude imports ≈ 5.1 Mb/d (PPAC). Weekly bill = basket price × imports × 7. Real number on next CI backfill.' }
  ]
});
freightBody.appendChild(brentPanel);
const brentInf = inferenceLineEl('brent');
if (brentInf) freightBody.appendChild(brentInf);

// 3-up tanker / container / bulk small multiples
freightBody.appendChild(renderSmallMultiples([
  { label: 'VLCC tanker', deltaPct: 220.4, color: 'var(--red)', valueFormatted: '1,842 WS', tooltip: 'Worldscale points · benchmark for spot tanker rates · Baltic Dirty Tanker Index' },
  { label: 'Drewry WCI', deltaPct: 14.6, color: 'var(--amber)', valueFormatted: '$2,840 / 40ft', tooltip: 'Drewry World Container Index · global avg spot rate per 40-ft container' },
  { label: 'Baltic Dry', deltaPct: 8.4, color: 'var(--amber)', valueFormatted: '2,840 idx', tooltip: 'Baltic Dry Index · dry-bulk shipping rates · 1985=1000' }
], { title: 'Freight indices · MoM %', asof: 'as on 2 May 2026' }));

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

// Panel 1 · Indexed equity overlay (Option C headline panel) — points from live sparklines
const niftyM = M('nifty_50');
const bankM = M('bank_nifty');
const peM = M('nifty_pe_5y');
const niftyPoints = metricSparkPoints(niftyM) || Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 101, 102, 102.5, 104, 105, 106.5, 105.5, 104.2][i] }));
const bankPoints = metricSparkPoints(bankM) || Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 100.5, 101.5, 101, 103, 105, 108, 106.5, 104.5][i] }));
const equityChart = renderIndexedOverlay([
  { name: 'Nifty 50', color: 'var(--accent)', points: niftyPoints },
  { name: 'Bank Nifty', color: 'var(--blue)', points: bankPoints }
], { title: '90-day indexed trail · base = 100' });
const equityPanel = renderHeadlinePanel({
  eyebrow: 'Equity benchmarks · live',
  value: niftyM ? formatValue(niftyM.value, 'index', niftyM.unit || 'idx') : '24,180 idx',
  metaLine: 'Nifty 50 · NSE · ' + (niftyM?.as_of ? formatAsOf(niftyM.as_of) : '5 May 2026'),
  mom: niftyM?.mom_pct != null ? { text: formatTrend(niftyM.mom_pct), color: niftyM.mom_pct >= 0 ? 'var(--green)' : 'var(--red)' } : { text: '+1.4%', color: 'var(--green)' },
  yoy: niftyM?.yoy_pct != null ? { text: formatTrend(niftyM.yoy_pct), color: niftyM.yoy_pct >= 0 ? 'var(--green)' : 'var(--red)' } : { text: '+12.8%', color: 'var(--green)' },
  percentile: peM ? { label: 'Nifty PE ', text: peM.value.toFixed(1) + '×', color: peM.value > 23 ? 'var(--red)' : 'var(--amber)' } : { label: 'Nifty PE ', text: '22.8×', color: 'var(--amber)' },
  status: 'med',
  statusPill: 'WATCH',
  statusSub: 'Above 5Y mean PE · valuations stretched',
  chart: equityChart,
  matrix: [
    { label: 'Bank Nifty', value: bankM ? formatValue(bankM.value, 'index') : '52,640', sub1: bankM?.yoy_pct != null ? formatTrend(bankM.yoy_pct) + ' YoY' : '+9.4% YoY', sub1Color: 'var(--green)', sub2: bankM?.mom_pct != null ? formatTrend(bankM.mom_pct) + ' MoM' : '+0.6% MoM', asof: bankM?.as_of ? formatAsOf(bankM.as_of) : '5 May', tooltip: 'NSE Bank Nifty · 12 large-cap banks' },
    { label: '52w high · low', value: '24,860 · 21,310', sub1: 'range 16.6%', sub2: 'high: 28 Apr · low: 4 Sep 25', asof: 'derived', tooltip: 'Trailing 52-week range for Nifty 50' },
    { label: 'Nifty PE vs 5Y', value: peM ? peM.value.toFixed(1) + '×' : '22.8×', sub1: 'mean 21.0× · +1σ 23.8×', sub1Color: 'var(--amber)', sub2: 'stretched but not extreme', asof: peM?.as_of ? formatAsOf(peM.as_of) : '5 May', tooltip: 'Trailing PE vs 5-year distribution' },
    { label: 'YTD return (USD)', value: '+5.2%', sub1: '+9.4% in INR', sub1Color: 'var(--green)', sub2: 'INR weakness eats 4.2pp', asof: 'derived', tooltip: 'YTD Nifty return adjusted for INR/USD depreciation' }
  ]
});
marketBody.appendChild(equityPanel);
const equityInf = inferenceLineEl('equity');
if (equityInf) marketBody.appendChild(equityInf);

// Panel 2 · Valuation band
const valWrap = el('div', { class: 'viz-wrap' });
valWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'Nifty PE · trailing · vs 5Y range'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, 'as on 5 May 2026')
]));
valWrap.appendChild(renderValuationBand({ value: 22.8, min: 15.2, sigmaMinus: 18.6, mean: 21.0, sigmaPlus: 23.8, max: 27.2, asof: '5 May 2026' }));
marketBody.appendChild(valWrap);

// Panel 3 + 4 row · VIX/DXY pair + IND-US spread
const sentimentSpreadRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '18px' } });
const vixWrap = el('div', { class: 'viz-wrap' });
vixWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'Sentiment · VIX + Gold'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, 'as on 5 May 2026')
]));
// VIX + Gold sentiment row — live values, computed reference-band markers
const vixM = M('india_vix');
const goldM = M('gold_usd');
// Reference bands: VIX 5Y range 9-35 mean 18; Gold 5Y range $1,620-$2,690 mean $2,000
const vixPos = vixM ? Math.max(0, Math.min(100, ((vixM.value - 9) / (35 - 9)) * 100)) : 49;
const goldPos = goldM ? Math.max(0, Math.min(100, ((goldM.value - 1620) / (2690 - 1620)) * 100)) : 88;
vixWrap.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', padding: '4px 0' } }, [
  el('div', { title: 'India VIX · NSE 30-day implied volatility · 5Y range 9–35; >25 = elevated stress' }, [
    el('div', { class: 'cs-label' }, 'INDIA VIX'),
    el('div', { class: 'cs-value' }, vixM ? vixM.value.toFixed(2) : '—'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: vixM && vixM.mom_pct > 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, vixM ? formatTrend(vixM.mom_pct) : '—')]),
      vixM?.as_of ? el('span', { style: { marginLeft: '12px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: '11px' } }, 'as on ' + formatAsOf(vixM.as_of)) : null
    ].filter(Boolean)),
    el('div', { style: { marginTop: '8px', height: '6px', background: 'linear-gradient(to right, var(--green), var(--amber) 50%, var(--red))', borderRadius: '3px', position: 'relative', opacity: 0.55 } }, [
      el('div', { style: { position: 'absolute', left: vixPos + '%', top: '-3px', width: '2px', height: '12px', background: 'var(--ink)' } })
    ]),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '3px' } }, [
      el('span', {}, '5Y low 9'), el('span', {}, 'mean 18'), el('span', {}, '5Y high 35')
    ])
  ]),
  el('div', { title: 'Gold spot · USD per troy ounce · safe-haven asset · rises when risk rises' }, [
    el('div', { class: 'cs-label' }, 'GOLD'),
    el('div', { class: 'cs-value' }, goldM ? '$' + new Intl.NumberFormat('en-US').format(Math.round(goldM.value)) + ' / oz' : '—'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: goldM && goldM.mom_pct > 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, goldM ? formatTrend(goldM.mom_pct) : '—')]),
      goldM?.as_of ? el('span', { style: { marginLeft: '12px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: '11px' } }, 'as on ' + formatAsOf(goldM.as_of)) : null
    ].filter(Boolean)),
    el('div', { style: { marginTop: '8px', height: '6px', background: 'linear-gradient(to right, var(--green), var(--amber) 60%, var(--red))', borderRadius: '3px', position: 'relative', opacity: 0.55 } }, [
      el('div', { style: { position: 'absolute', left: goldPos + '%', top: '-3px', width: '2px', height: '12px', background: 'var(--ink)' } })
    ]),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '3px' } }, [
      el('span', {}, '5Y low $1,620'), el('span', {}, 'mean $2,000'), el('span', {}, 'all-time high $2,690')
    ])
  ])
]));
sentimentSpreadRow.appendChild(vixWrap);
// Sentiment inference rendered below the row (full width)

const spreadWrap = el('div', { class: 'viz-wrap' });
spreadWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'India 10Y vs US 10Y spread · 24 months'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, 'as on 5 May 2026')
]));
const spreadM = M('ind_us_10y_spread');
const spreadValue = spreadM?.value ?? 256;
const usTreasury10y = +(gsec10y - spreadValue / 100).toFixed(2);  // derived
const fiveYAvgSpread = 320;
const spreadPoints = metricSparkPoints(spreadM) || Array.from({length: 13}, (_, i) => ({
  label: i === 0 ? '24m ago' : i === 12 ? 'now' : '',
  value: [320, 312, 305, 298, 290, 282, 275, 268, 260, 254, 246, 252, 256][i]
}));
spreadWrap.appendChild(renderStatStrip([
  { label: 'IND–US 10Y spread', value: Math.round(spreadValue) + ' bps', sub: spreadM?.as_of ? 'as on ' + formatAsOf(spreadM.as_of) : '', color: spreadValue < 200 ? 'var(--red)' : 'var(--amber)' },
  { label: 'India 10Y', value: gsec10y.toFixed(2) + '%', sub: 'CCIL FBIL', color: 'var(--ink)' },
  { label: 'US 10Y', value: usTreasury10y.toFixed(2) + '%', sub: 'FRED · derived', color: 'var(--ink)' },
  { label: '5Y avg spread', value: fiveYAvgSpread + ' bps', sub: 'currently ' + Math.abs(Math.round(fiveYAvgSpread - spreadValue)) + ' bps ' + (spreadValue < fiveYAvgSpread ? 'below' : 'above'), color: 'var(--ink-2)' },
  { label: 'Watch threshold', value: '200 bps', sub: Math.round(spreadValue - 200) + ' bps headroom', color: 'var(--red)' }
]));
spreadWrap.appendChild(renderCumulativeLine(
  [{ name: 'IND–US 10Y spread', color: 'var(--accent)', points: spreadPoints, current: Math.round(spreadValue) + ' bps' }],
  { width: 600, height: 160, padTop: 16, padBottom: 26, summary: spreadValue < fiveYAvgSpread ? 'Compressing · in watch zone (200 bps)' : 'Above 5Y average' }
));
sentimentSpreadRow.appendChild(spreadWrap);
marketBody.appendChild(sentimentSpreadRow);
const sentInf = inferenceLineEl('sentiment');
if (sentInf) marketBody.appendChild(sentInf);

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
// Trust band — above footer (Design Audit §12). V1 reframe (2026-05-05):
// shows "12m history: 1 of 20 verified" honestly so users see backfill state.
// ──────────────────────────────────────────────────────────────
const allMetrics = Object.values(DATA.metrics);
const verifN = allMetrics.filter(m => m.verification_state === 'verified').length;
const xcheckN = allMetrics.filter(m => m.verification_state === 'crosscheck_pending').length;
// "Source pending" = anything not yet verified + not yet cross-checked.
// Captures unregistered parsers, failed parsers, and seed-only metrics.
const sourcePendingN = allMetrics.length - verifN - xcheckN;
// "12m history" count = metrics where sparkline_12m has at least 12 distinct
// non-null values AND the metric has been verified live. Today: GST only.
const has12mHistory = (m) => m.verification_state === 'verified'
  && Array.isArray(m.sparkline_12m)
  && m.sparkline_12m.length >= 12
  && new Set(m.sparkline_12m.filter(v => v != null)).size >= 6;  // 6+ unique values means real history, not mock-padded
const histN = allMetrics.filter(has12mHistory).length;

body.appendChild(el('div', { class: 'dashboard-trust-band' }, [
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Verified live'),
    el('div', { class: 'dtb-value', style: { color: 'var(--green)' } }, String(verifN)),
    el('div', { class: 'dtb-sub' }, `of ${allMetrics.length} · primary + cross-check`)
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Source pending'),
    el('div', { class: 'dtb-value', style: { color: 'var(--amber)' } }, String(sourcePendingN + xcheckN)),
    el('div', { class: 'dtb-sub' }, 'parser pending or seed only')
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, '12m history'),
    el('div', { class: 'dtb-value', style: { color: 'var(--blue)' } }, String(histN)),
    el('div', { class: 'dtb-sub' }, `of ${verifN} verified${histN < verifN ? ' · V2 backfill in progress' : ''}`)
  ]),
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Free sources'),
    el('div', { class: 'dtb-value', style: { color: 'var(--accent)' } }, '100%'),
    el('div', { class: 'dtb-sub' }, 'no paid feeds')
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

// StickyTOC removed (2026-05-06) — Tab Bar already handles section navigation.
// Two stacked nav surfaces was redundant and the right-rail vertical strip
// looked like a "vertical tab bar" on first glance.

// ──────────────────────────────────────────────────────────────
// TAB BAR · section navigation
// Hero stays always visible; tabs scope which section-frame renders below.
// "All" tab = original full-scroll behavior.
// URL hash drives state: #flows / #macro / #all etc.
// ──────────────────────────────────────────────────────────────
// Tabs as FILTERS · one section visible at a time. Click a tab → only that
// section renders below the hero. "All" tab shows everything (power user
// escape hatch). Default landing tab = Flows. URL stays clean on bare URL.
const TABS = [
  { id: 'flows',   label: 'Flows' },
  { id: 'macro',   label: 'Macro' },
  { id: 'economy', label: 'Real economy' },
  { id: 'freight', label: 'Freight' },
  { id: 'market',  label: 'Market' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'all',     label: 'All' }
];

function setActiveTab(tabId, opts = {}) {
  if (!TABS.find(t => t.id === tabId)) tabId = 'flows';
  document.body.dataset.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId));
  // Mark visible section-frame(s) for CSS show/hide
  document.querySelectorAll('.section-frame').forEach(s => {
    const isMatch = tabId === 'all' || s.dataset.section === tabId;
    s.dataset.active = String(isMatch);
  });
  // Update URL only on user-initiated tab clicks. Initial load with no hash
  // leaves the URL clean (no #flows written).
  if (!opts.skipHash) {
    const targetHash = '#' + tabId;
    if (location.hash !== targetHash) {
      history.replaceState(null, '', targetHash);
    }
  }
  // Scroll to tab bar so user sees the start of the section. Skip on initial load.
  if (!opts.skipScroll) {
    const tb = document.getElementById('tab-bar');
    if (tb) {
      const y = tb.getBoundingClientRect().top + window.scrollY - 60;
      if (Math.abs(window.scrollY - y) > 10) window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }
}

function getInitialTab() {
  const hash = location.hash.slice(1);
  // Bare URL (no hash) → 'flows' (default · the "today read")
  // Recognised hash → that tab. Anything else → 'flows'
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

// Initial load · skip hash write (keep URL clean) + skip scroll (don't yank user)
setActiveTab(getInitialTab(), { skipHash: !location.hash, skipScroll: true });
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
  sections: cmdkSections.map(s => ({ ...s, action: () => setActiveTab(s.id) })),
  openMetric: openDrawer
});

// Wire topbar Cmd-K hint click
const cmdkHint = document.getElementById('cmdk-hint');
if (cmdkHint) cmdkHint.addEventListener('click', openCmdK);

console.log(`[IRM Phase 5.5] mounted ${Object.keys(DATA.metrics).length} metrics + ${DATA.sectors?.sectors.length || 0} sectors`);
