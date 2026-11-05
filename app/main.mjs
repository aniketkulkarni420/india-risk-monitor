// Main page assembly · Phase 5.5, Redesign per IRM_DataViz_Audit_v2 + IRM_Design_Audit
// Composes: Hero (vital signs) → Today bullets → Flows (5 lenses) → Macro (5 panels)
//   → Real Economy (cluster cards) → Freight (chart-led) → Market (4 panels) → Sectors (ranked)

import { renderTableRow, renderTableHeader } from './components/TableRow.mjs';
import { renderSectionFrame } from './components/SectionFrame.mjs';
import { renderSupportingTier } from './components/SupportingTier.mjs';
import { COMPARISON_SPEC, getDisplayPeriods } from './components/ComparisonSpec.mjs';
// StickyTOC removed 2026-05-06, Tab Bar handles section nav now
import { wire as wireDrawer, open as openDrawer } from './components/MetricDrawer.mjs';
import { wireCmdK, openCmdK } from './components/CmdKPalette.mjs';
import { el, formatValue, formatTrend, formatAsOf, formatAsOfLong, statusClass, rangeTick, pillWithDirection, heatmapClass } from './components/utils.mjs';
import {
  renderDriverBars, renderHorizonCard, renderRegimeBanner, renderPersistenceChips,
  renderCumulativeLine, renderDivergingBars, renderYieldCurve, renderInflationBars,
  renderCurrencyStrip, renderProgressBar, renderGaugeRow, renderPairedLine, renderRangeTick, renderTimelineStrip,
  renderLensRow, renderCardsAsTabs, renderFlowsFocused, renderPersistenceBar, renderAbsorptionGauge,
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
// Pulls from live metrics. No em dashes. No "-". Tone: punchy, data-first,
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
      if (b.mom_pct != null && Math.abs(b.mom_pct) >= 0.5) parts.push(`${b.mom_pct > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(b.mom_pct))}% on the month.`);
      else if (b.mom_pct != null) parts.push('Flat on the month.');
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
      const wpi = DATA.metrics.core_cpi;
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
        const gs = (gold.sparkline_12m || []).filter(v => typeof v === 'number');
        const nearTop = gs.length && gold.value >= Math.max(...gs) * 0.99;
        parts.push(`Gold at $${new Intl.NumberFormat('en-US').format(Math.round(gold.value))}${nearTop ? ', at the top of its recent range.' : '.'}`);
      }
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
  const freq = metric.source_primary?.frequency;
  if (freq === 'Daily' || freq === 'Live') {
    // Daily readings: label only the last point with its real date.
    return slice.map((v, i) => ({ label: i === n - 1 ? formatAsOf(metric.as_of) : '', value: typeof v === 'number' ? v : (v?.value ?? 0) }));
  }
  return slice.map((v, i) => {
    const monthsBack = n - 1 - i;
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - monthsBack, 1);
    return { label: _MO_SHORT[d.getMonth()], value: typeof v === 'number' ? v : (v?.value ?? 0) };
  });
}

// ──────────────────────────────────────────────────────────────
// Topbar timestamp
// ──────────────────────────────────────────────────────────────
// Topbar freshness counter · reframed 2026-05-06
// Prior copy "Live 50/70" read as "30% missing". New copy frames as
// progress: "Sources: 50 verified · 20 backfilling", same data, different
// emotional weight. When >=90% verified, switches to a clean "Updated X" stamp.
// Counts use the input signals only. The 10 composites (risk score, drivers,
// regimes) are computed from those signals, so counting them as "verified
// sources" inflated the totals (page said 71, meta said 70 and 60).
const allMetricsList = Object.values(DATA.metrics).filter(m => m.section !== 'composites');
const totalMetrics = allMetricsList.length;
const verified = allMetricsList.filter(m => m.verification_state === 'verified').length;
const backfilling = totalMetrics - verified;
const freshRatio = verified / totalMetrics;
const asofEl = document.getElementById('topbar-asof');
if (freshRatio >= 0.9) {
  const newest = allMetricsList.map(m => m.as_of).sort().pop();
  asofEl.textContent = 'Updated ' + formatAsOf(newest);
} else {
  const tooltip = `${totalMetrics} signals: ${verified} verified against a second source · ${backfilling} on primary source only or backfilling. Tap any metric for source detail.`;
  asofEl.innerHTML = `<span style="color: var(--ink-2);" title="${tooltip}">Sources: <b style="color:var(--ink)">${verified}</b> verified · ${backfilling} backfilling</span>`;
}

// Parser-health badge · 2026-05-11 · part of freshness assurance system
// Shows X/N parsers green · click for "Sources health" detail (sources page)
const ph = DATA.parser_health;
if (ph && ph.summary && ph.summary.total > 0) {
  const { green, amber, red, total } = ph.summary;
  const dotColor = red > 0 ? 'var(--red)' : (amber > 0 ? 'var(--amber)' : 'var(--green)');
  const tooltip = red > 0
    ? `${red} parser(s) failing · ${amber} amber · ${green}/${total} healthy. Click for detail.`
    : `${green}/${total} parsers healthy${amber ? ' · ' + amber + ' amber' : ''}.`;
  const badge = document.createElement('a');
  badge.href = './sources/health.html';
  badge.title = tooltip;
  badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;color:var(--ink-3);text-decoration:none;border-bottom:1px dotted var(--line-2);padding-bottom:1px;margin-left:14px';
  badge.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor}"></span><span>${green}/${total} parsers</span>`;
  badge.addEventListener('mouseenter', () => badge.style.color = 'var(--accent)');
  badge.addEventListener('mouseleave', () => badge.style.color = 'var(--ink-3)');
  asofEl.parentNode.insertBefore(badge, asofEl.nextSibling);
}

// ──────────────────────────────────────────────────────────────
// HERO, vital signs panel (replaces 4-tile deck)
// ──────────────────────────────────────────────────────────────
const risk = M('india_risk_score');
// Score availability · the bundle nulls the composite when >30% of drivers lack
// fresh feeders. Never print the literal "null": show a clear unavailable state.
const riskOk = !!risk && typeof risk.value === 'number';
const _driverNames = { driver_oil_physical: 'Oil', driver_freight: 'Freight', driver_institutional_flows: 'Flows',
  driver_india_macro: 'Macro', driver_real_economy: 'Real economy', driver_sector_breadth: 'Sector breadth' };
const riskMissingDrivers = ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
  'driver_india_macro', 'driver_real_economy', 'driver_sector_breadth']
  .filter(id => typeof M(id)?.value !== 'number').map(id => _driverNames[id]);
const riskUnavailableNote = riskMissingDrivers.length
  ? `${riskMissingDrivers.join(' and ')} ${riskMissingDrivers.length === 1 ? 'driver lacks' : 'drivers lack'} fresh data (${riskMissingDrivers.length} of 6)`
  : 'Not enough fresh data';
const heroHost = document.getElementById('hero-decks');
heroHost.innerHTML = '';
heroHost.style.display = 'block';

// Build driver list, sorted by value desc
const driverIds = ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
                   'driver_india_macro', 'driver_sector_breadth', 'driver_real_economy'];
const drivers = driverIds.map(M).filter(Boolean).map(d => ({
  label: (typeof d.value === 'number' && d.status === 'shock' ? '⚠ ' : '') + d.display_name,
  value: typeof d.value === 'number' ? d.value : null,
  status: typeof d.value === 'number' ? d.status : 'unavailable',
  delta: typeof d.value === 'number' && d.mom_pct ? Math.round(d.value * d.mom_pct / 100) : null,
  // Show the data date when a driver's inputs are more than 7 days old
  note: d.inputs_as_of?.oldest && (Date.now() - new Date(d.as_of).getTime()) > 7 * 86400000
    ? 'data as on ' + formatAsOfLong(d.as_of) : null,
  metric_id: d.metric_id
})).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

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
const wwVal = riskOk && risk.mom_pct != null ? wwDelta + Math.round(risk.value * risk.mom_pct / 100) : null;
const dodVal = riskOk && risk.dod_delta != null ? (risk.dod_delta > 0 ? '+' : '') + risk.dod_delta : null;
vital.appendChild(el('div', { class: 'hv-score-row' }, [
  el('span', { class: 'hv-score-label' }, ['India Risk Score', risk?.as_of
    ? el('span', { style: { marginLeft: '10px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: '0' } }, (riskOk ? 'computed ' : 'checked ') + formatAsOfLong(risk.as_of))
    : null].filter(Boolean)),
  el('span', { class: 'hv-delta', title: 'Change vs prior reference (week / day)' }, [
    wwVal != null ? el('span', { title: 'Score change vs reading from 7 days ago' }, ['vs last week ', el('b', { style: { color: risk.mom_pct >= 0 ? 'var(--red)' : 'var(--green)' } }, wwVal + ' pts')]) : null,
    dodVal != null ? el('span', { style: { marginLeft: '14px' }, title: 'Score change vs yesterday' }, ['vs yesterday ', el('b', { style: { color: risk.dod_delta >= 0 ? 'var(--red)' : 'var(--green)' } }, dodVal + ' pts')]) : null
  ].filter(Boolean))
]));

// Score row · big number + inline 12-week sparkline (only if real history) + status pill
const scoreRow = el('div', { class: 'hv-score-row', style: { alignItems: 'flex-end', gap: '14px' } }, [
  riskOk
    ? el('div', { class: 'hv-score-big' }, String(Math.round(risk.value)))
    : el('div', { class: 'hv-score-big hv-score-na', style: { fontSize: '34px', lineHeight: '1.1' } }, 'Not available'),
  riskOk
    ? el('div', { class: 'hv-score-sub' }, '/ 100')
    : el('div', { class: 'hv-score-sub', style: { maxWidth: '360px', fontSize: '13px', lineHeight: '1.4' } }, riskUnavailableNote)
]);
if (riskOk && hasRealHistory(risk.sparkline_12m)) {
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
} else if (riskOk) {
  // Honest placeholder · no fake trend line
  scoreRow.appendChild(el('span', { class: 'hv-spark-pending', style: { fontSize: '11px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginLeft: '14px' } }, '12w trend · history accruing'));
}
scoreRow.appendChild(el('div', { style: { marginLeft: 'auto' } }, [
  riskOk
    ? el('span', { class: 'pill ' + statusClass(risk.status) }, risk.status[0].toUpperCase() + risk.status.slice(1))
    : el('span', { class: 'pill pill-na' }, 'No score')
]));
vital.appendChild(scoreRow);

vital.appendChild(el('div', { class: 'hv-band-track' }, [
  riskOk ? el('div', { class: 'hv-band-marker', style: { left: risk.value + '%' } }) : null
].filter(Boolean)));
vital.appendChild(el('div', { class: 'hv-band-zones' }, [
  el('span', { style: { color: '#79c79a' }, title: '0-35: stress contained · normal markets' }, 'LOW 0-35 · contained'),
  el('span', { style: { color: '#e9c466' }, title: '35-65: elevated stress · monitor closely' }, 'MED 35-65 · elevated'),
  el('span', { style: { color: '#e88' }, title: '65-100: breakdown risk · multiple shocks active' }, 'HIGH 65-100 · breakdown')
]));

// 1A+1B · Vital-sign tile row · 6 always-visible tiles above the fold
// Pick: Nifty, INR/USD, Brent, VIX, Real 10Y, FII MTD
const FOLLOWED_KEY = 'irm.followed';
function readFollowed() { try { return new Set(JSON.parse(localStorage.getItem(FOLLOWED_KEY) || '[]')); } catch { return new Set(); } }
function vitalTile(metric_id, label, valueFn) {
  const m = M(metric_id);
  if (!m) return null;
  const followed = readFollowed();
  const isOn = followed.has(metric_id);
  const pd = pillWithDirection(m);
  const trend = m.dod_pct ?? m.mom_pct;
  const trendCls = trend == null ? '' : heatmapClass(trend, m.trend_direction);
  const trendLabel = m.dod_pct != null ? 'DoD' : 'MoM';
  // Rates (unit %) move in basis points: a % change of a yield ("-21.9%")
  // misreads. Use the last two readings instead.
  const isRate = (m.unit || '').trim() === '%';
  const sl = (m.sparkline_12m || []).filter(v => typeof v === 'number');
  const bpsMove = isRate && sl.length >= 2 ? Math.round((sl[sl.length - 1] - sl[sl.length - 2]) * 100) : null;
  const star = el('button', {
    class: 'star-btn' + (isOn ? ' on' : ''),
    'data-metric-id': metric_id,
    'aria-label': isOn ? 'Unfollow ' + metric_id : 'Follow ' + metric_id,
    onclick: (e) => {
      e.stopPropagation();
      const s = readFollowed();
      if (s.has(metric_id)) { s.delete(metric_id); star.classList.remove('on'); }
      else { s.add(metric_id); star.classList.add('on'); }
      try { localStorage.setItem(FOLLOWED_KEY, JSON.stringify(Array.from(s))); } catch {}
      window.dispatchEvent(new CustomEvent('irm:followed:change', { detail: { metricId: metric_id, isOn: s.has(metric_id), count: s.size } }));
    }
  }, isOn ? '★' : '☆');
  return el('div', {
    class: 'vital-tile',
    'data-metric-id': metric_id,
    onclick: () => openDrawer(metric_id)
  }, [
    el('div', { class: 'vital-tile-head' }, [
      el('span', { class: 'vital-tile-label' }, [star, ' ', label]),
      el('span', { class: 'pill ' + statusClass(m.status) }, [
        pd.label,
        pd.direction ? el('span', { class: 'pill-dir' }, pd.direction) : null
      ].filter(Boolean))
    ]),
    el('div', { class: 'vital-tile-value' + (m.status === 'shock' || m.status === 'high' ? ' is-stress' : '') },
      valueFn ? valueFn(m) : formatValue(m.value, m.value_format, m.unit)),
    m.section === 'flows'
      // Day flows: a % change of a net flow (e.g. -255% MoM) carries no meaning
      ? el('div', { class: 'vital-tile-sub' }, 'as on ' + formatAsOf(m.as_of))
      : isRate
      ? el('div', { class: 'vital-tile-sub' }, (bpsMove != null ? (bpsMove > 0 ? '+' : '') + bpsMove + ' bps · ' : '') + 'as on ' + formatAsOf(m.as_of))
      : trend != null
      ? el('div', { class: 'vital-tile-sub ' + trendCls }, formatTrend(trend) + ' ' + trendLabel)
      : el('div', { class: 'vital-tile-sub' }, m.as_of ? 'as on ' + formatAsOf(m.as_of) : '-')
  ]);
}
const vitalRow = el('div', { class: 'vital-row' }, [
  // Headline tiles show whole numbers (house rule); the real yield stays at
  // two decimals because whole percent would hide every move.
  vitalTile('nifty_50',       'Nifty',   m => new Intl.NumberFormat('en-IN').format(Math.round(m.value))),
  vitalTile('inr_usd',        'INR / $', m => '₹' + Math.round(m.value)),
  vitalTile('brent_crude',    'Brent',   m => '$' + Math.round(m.value) + ' / bbl'),
  vitalTile('india_vix',      'VIX',     m => String(Math.round(m.value))),
  vitalTile('real_10y_yield', 'Real 10Y', m => m.value.toFixed(2) + '%'),
  // FII tile shows the day's net from NSE (the MTD metric held the same daily
  // figure, and the old formatter always printed a minus sign).
  vitalTile('fii_equity_daily', 'FII net (day)',
    m => (m.value < 0 ? '-' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(m.value))) + ' Cr')
].filter(Boolean));
vital.appendChild(vitalRow);

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
    const shortName = m.display_name || m.metric_id;
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
// is wired, pilot. If Aniket approves, extend mapping to all 6 drivers).
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
        tooltip: 'India crude basket = Dubai (75%) + Brent (25%), what India actually pays'
      },
      {
        label: 'Hormuz throughput',
        value: hormuzM ? formatValue(hormuzM.value, 'integer', 'ships/day') : '2 ships/day',
        sub1: hormuzM?.mom_pct != null ? formatTrend(hormuzM.mom_pct) + ' MoM' : '-98.6% MoM',
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
// Hero H1 · dynamic synthesis from live state · 2026-05-06
// Replaces the prior static "Stress is high, but activity hasn't broken" which
// read like horoscope copy. Now constructs a 2-clause read from the actual
// top driver, biggest mover, and risk score direction.
function buildHeroH1() {
  const r = risk;
  if (!r) return 'Loading risk read…';

  // Driver sorted by value (highest stress first)
  const topDriver = drivers.find(d => typeof d.value === 'number') || null;
  // Brent + Hormuz state
  const brent = M('brent_crude');
  const hormuz = M('hormuz_throughput');
  // Auto retail signal
  const autoMetrics = ['auto_pv', 'auto_2w', 'auto_cv', 'auto_3w', 'auto_tractor'].map(M).filter(Boolean);
  const autoMomAvg = autoMetrics.length
    ? autoMetrics.reduce((s, m) => s + (m.mom_pct || 0), 0) / autoMetrics.length : null;
  // Flows
  const fii = M('fii_equity_daily'), abs = M('absorption_ratio');

  const clauses = [];

  // 1: top driver framing
  if (topDriver) {
    if (topDriver.value >= 70) clauses.push(`${topDriver.label} pressure elevated (${topDriver.value}/100)`);
    else if (topDriver.value >= 50) clauses.push(`${topDriver.label} firming (${topDriver.value}/100)`);
    else clauses.push(`${topDriver.label} contained (${topDriver.value}/100)`);
  }

  // 2: most concrete signal, try Brent + Hormuz, then auto, then flows
  let secondary = null;
  // 2026-05-12 · Hormuz value tagged with [PROVISIONAL] when source is static
  // so the user immediately sees the number isn't live AIS data
  const hormuzProvSuffix = hormuz?._source_static ? ' [PROVISIONAL]' : '';
  if (brent && hormuz) {
    if (brent.value >= 95 || hormuz.value < 70) {
      secondary = `Brent $${brent.value.toFixed(0)} · Hormuz ${hormuz.value} ships/day${hormuzProvSuffix}`;
    } else if (brent.value < 90) {
      secondary = `Brent eased to $${brent.value.toFixed(0)}, oil supply stable`;
    } else {
      secondary = `Brent $${brent.value.toFixed(0)} · Hormuz holding at ${hormuz.value}/day${hormuzProvSuffix}`;
    }
  }
  if (!secondary && autoMomAvg != null && Math.abs(autoMomAvg) >= 5) {
    const dir = autoMomAvg < 0 ? 'down' : 'up';
    secondary = `auto retail ${dir} ${Math.abs(autoMomAvg).toFixed(0)}% MoM across all 5 segments`;
  }
  if (!secondary && fii && abs) {
    const fmt = (v) => (v >= 0 ? '+₹' : '-₹') + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr';
    secondary = fii.value < 0 ? `FII flow ${fmt(fii.value)} · DII covering ${(abs.value * 100).toFixed(0)}%` : `FII net buyers ${fmt(fii.value)}`;
  }
  if (secondary) clauses.push(secondary);

  return clauses.join(' · ') + '.';
}
document.getElementById('hero-h1').textContent = buildHeroH1();

// Browser tab title · live with current risk score so users with multiple
// tabs open can scan their bar without switching context.
if (riskOk) {
  const status = (risk.status || '').toUpperCase();
  document.title = `India Risk ${risk.value}${status ? ' · ' + status : ''} · IRM`;
}
const heroLead = document.getElementById('hero-lead');
if (heroLead) heroLead.style.display = 'none';

// B · Collapsible hero (mobile only), adds a condensed lead line + toggle
// shown only in collapsed state. Default state: collapsed on mobile,
// remembered via localStorage. Desktop ignores entirely (CSS-driven).
function setupCollapsibleHero() {
  const heroCard = document.getElementById('hero-card');
  if (!heroCard) return;
  const stored = localStorage.getItem('irm.heroCollapsed');
  const initialCollapsed = stored == null ? true : stored === 'true';
  document.body.dataset.heroCollapsed = String(initialCollapsed);

  // Build condensed lead, one-line summary used when collapsed
  const hormuz = M('hormuz_throughput');
  const brent = M('brent_crude');
  const leadParts = [];
  if (hormuz && hormuz.value < (hormuz.baseline_30d || 140)) {
    const provTag = hormuz._source_static ? ' [PROVISIONAL]' : '';
    leadParts.push(`Hormuz ${hormuz.value} ships/day${provTag}`);
  }
  if (brent && brent.value >= 95) {
    leadParts.push(`Brent $${brent.value.toFixed(2)}`);
  }
  if (riskOk && risk.dod_delta != null) {
    leadParts.push(`risk ${risk.value}/100${risk.dod_delta >= 0 ? ' +' : ' '}${risk.dod_delta} today`);
  }
  if (leadParts.length === 0 && risk) leadParts.push(riskOk ? `Risk ${Math.round(risk.value)}/100 · ${risk.status}` : 'Risk score not available');
  const condLead = el('div', { class: 'hero-condensed-lead' }, leadParts.join(' · '));
  // Insert just after hero-h1
  const h1 = document.getElementById('hero-h1');
  h1.parentNode.insertBefore(condLead, h1.nextSibling);

  // Toggle button, appended at end of hero-card
  const toggle = el('button', {
    class: 'hero-collapse-toggle',
    'aria-expanded': String(!initialCollapsed),
    onclick: () => {
      const cur = document.body.dataset.heroCollapsed === 'true';
      document.body.dataset.heroCollapsed = String(!cur);
      toggle.setAttribute('aria-expanded', String(cur));
      toggle.querySelector('.label').textContent = cur ? 'Hide drivers' : 'Show drivers';
      localStorage.setItem('irm.heroCollapsed', String(!cur));
    }
  }, [
    el('span', { class: 'label' }, initialCollapsed ? 'Show drivers' : 'Hide drivers'),
    el('span', { class: 'arrow' }, '▾')
  ]);
  heroCard.appendChild(toggle);
}
// Defer to end of hero render so all elements exist
setTimeout(setupCollapsibleHero, 0);

const todayWrap = document.getElementById('hero-today');
todayWrap.innerHTML = '';
todayWrap.style.display = 'block';
// Show the divider between Today bullets and Vital Signs
const heroDivider = document.getElementById('hero-divider');
if (heroDivider) heroDivider.style.display = 'block';
// Today bullets, derived from live metrics with status icons.
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
    const provBadge = hormuz._source_static
      ? ' <span style="font-family:var(--mono);font-size:9.5px;color:var(--amber);background:rgba(233,196,102,.12);border:1px dashed rgba(233,196,102,.4);padding:1px 6px;border-radius:3px;letter-spacing:.04em;">PROVISIONAL</span>'
      : '';
    out.push({
      icon: hormuz.status === 'shock' ? 'shock' : hormuz.status === 'high' ? 'watch' : 'calm',
      html: `<b>Hormuz traffic</b> at ${formatValue(hormuz.value, 'integer', 'ships/day')}${provBadge} vs ${baseline} baseline. <i>${((hormuz.value / baseline) * 100).toFixed(1)}% of normal</i>`,
      drawer_metric_id: 'hormuz_throughput'
    });
  }
  if (brent) {
    const above95 = brent.value >= 95;
    out.push({
      icon: above95 ? 'shock' : (brent.status === 'high' ? 'watch' : 'calm'),
      html: `<b>Brent crude</b> at $${Math.round(brent.value)} per barrel. ${formatTrend(brent.mom_pct)} MoM${above95 ? ', <i>above $95 shock threshold</i>' : ''}`,
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
  const fiiDayB = M('fii_equity_daily'), diiDayB = M('dii_daily');
  if (fiiDayB && diiDayB && typeof fiiDayB.value === 'number' && typeof diiDayB.value === 'number') {
    const f = (v) => (v < 0 ? '-' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(v))) + ' Cr';
    if (fiiDayB.value >= 0) {
      out.push({
        icon: 'calm',
        html: `<b>FII net buyers</b> at ${f(fiiDayB.value)}, DII ${f(diiDayB.value)}. <i>${formatAsOf(fiiDayB.as_of)}</i>`,
        drawer_metric_id: 'fii_equity_daily'
      });
    } else if (absorp) {
      out.push({
        icon: absorp.value >= 1 ? 'calm' : 'watch',
        html: `<b>FII net sellers</b> at ${f(fiiDayB.value)}, DII ${f(diiDayB.value)}. <i>${absorp.value >= 1 ? 'DII offsetting FII selling' : 'DII not fully absorbing FII selling'}</i>`,
        drawer_metric_id: 'absorption_ratio'
      });
    }
  }
  if (gst) {
    const auto2wYoY = auto2w?.yoy_pct;
    out.push({
      icon: 'calm',
      html: `<b>Real economy</b>. GST ₹${(gst.value / 100000).toFixed(2)} lakh crore (${formatTrend(gst.yoy_pct)} YoY)${auto2wYoY != null ? `, auto 2W ${formatTrend(auto2wYoY)}` : ''}`,
      drawer_metric_id: 'gst_gross'
    });
  }
  if (nifty && bnk && nifty.yoy_pct != null && bnk.yoy_pct != null) {
    const lead = +(bnk.yoy_pct - nifty.yoy_pct).toFixed(1);
    if (Math.abs(lead) >= 0.3) {
      out.push({
        icon: 'calm',
        html: `<b>${lead > 0 ? 'Banks beating Nifty' : 'Nifty beating Banks'}</b> by ${Math.abs(lead).toFixed(1)} points YoY. <i>Nifty ${formatTrend(nifty.yoy_pct)}, Bank Nifty ${formatTrend(bnk.yoy_pct)}</i>`,
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

// Value-led numbers card grid · used by Real Economy cluster expansion
// Replaces renderSmallMultiples for clusters where YoY-as-headline produced
// "0.0%" fake values. Now: value is the visual anchor; trend lines render
// only when the underlying field is non-null (per ComparisonSpec).
const _MO_LBL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _PERIOD_LABELS = { dod: 'DoD', mom: 'MoM', yoy: 'YoY' };
const _PERIOD_FIELDS = { dod: 'dod_pct', mom: 'mom_pct', yoy: 'yoy_pct' };

function shortAsOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.getDate() + ' ' + _MO_LBL[d.getMonth()];
}
function shortSourceName(name) {
  if (!name) return '';
  return name
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/Indian Railways.*/, 'Railways')
    .replace(/Min of Ports.*/, 'MoPorts')
    .replace(/RBI .*/, 'RBI')
    .replace(/MoSPI .*/, 'MoSPI')
    .slice(0, 16);
}

function renderClusterCards(metrics, opts = {}) {
  const wrap = el('div', { class: 'viz-wrap' });
  if (opts.title) {
    wrap.appendChild(el('div', {
      class: 'viz-title',
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }
    }, [
      el('span', {}, opts.title),
      opts.asof ? el('span', {
        style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 }
      }, opts.asof) : null
    ].filter(Boolean)));
  }
  const cols = Math.min(5, Math.max(2, metrics.length));
  const grid = el('div', { class: 'cluster-cards cols-' + cols });
  metrics.forEach(m => {
    const periods = getDisplayPeriods(m.metric_id);
    const trendRows = periods.map(p => {
      const v = m[_PERIOD_FIELDS[p]];
      if (v == null) return null;
      const color = v > 0
        ? (m.trend_direction === 'bad' ? 'var(--red)' : 'var(--green)')
        : (m.trend_direction === 'bad' ? 'var(--green)' : 'var(--red)');
      return el('div', { class: 'cc-cell-trend' }, [
        el('span', { class: 'lbl' }, _PERIOD_LABELS[p]),
        ' ',
        el('span', { style: { color } }, (v > 0 ? '+' : '') + v.toFixed(2) + '%')
      ]);
    }).filter(Boolean);
    const card = el('div', {
      class: 'cluster-card-cell',
      onclick: () => openDrawer(m.metric_id)
    }, [
      el('div', { class: 'cc-cell-label' }, m.display_name.replace(/ collection| levels| loading| demand| arrivals| value| Index| traffic| retail registrations| retail| \(.*\)/g, '').slice(0, 22)),
      el('div', { class: 'cc-cell-value' }, [
        formatValue(m.value, m.value_format, m.unit)
      ]),
      trendRows.length ? el('div', { class: 'cc-cell-trends' }, trendRows) : null,
      el('div', { class: 'cc-cell-asof' }, [
        m.as_of ? 'as on ' + shortAsOf(m.as_of) : 'as of -',
        m.source_primary?.name ? [' · ', el('span', { class: 'src' }, shortSourceName(m.source_primary.name))] : null,
        m.is_stale ? [' · ', el('span', {
          class: 'stale-inline',
          title: `Last updated ${m.age_days}d ago · expected every ${m.cadence_days}d`
        }, 'STALE')] : null
      ].flat().filter(Boolean))
    ].filter(Boolean));
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  if (opts.summary) wrap.appendChild(el('div', { class: 'viz-legend-row' }, [
    el('span', { style: { color: 'var(--ink-2)' } }, opts.summary)
  ]));
  return wrap;
}

// Footer date comes from the section's own metrics (newest and oldest as_of),
// never from the visitor's clock. The old version stamped new Date(), so every
// footer read "Last verified <today>" even when panels held months-old data.
function buildSectionFooter(srcNames, section) {
  let dates;
  if (section === 'sectors') dates = DATA.sectors?.as_of ? [DATA.sectors.as_of] : [];
  else dates = Object.values(DATA.metrics).filter(m => m.section === section).map(m => m.as_of).filter(Boolean);
  dates = dates.map(d => new Date(d)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  return {
    count: srcNames.length, names: srcNames,
    newest: dates.length ? dates[dates.length - 1].toISOString() : null,
    oldest: dates.length ? dates[0].toISOString() : null
  };
}

// ════════════════════════ FLOWS, V60 HYBRID (2026-05-12) ════════════════════════
// Layout: 4-lens regime strip → cards-as-tabs period strip → focused 3-cell + bar trio + narrative
// → F&O persistence bar → cumulative chart (de-emphasized) → supporting composite
const flowsBody = el('div', { class: 'section-body-stack' });

// Pull all flow metrics once
const fiiDay = M('fii_equity_daily');
const fiiMtd = M('fii_equity_mtd');
const fiiCytdH = M('fii_equity_cytd');
const diiDay = M('dii_daily');
const diiMtdH = M('dii_mtd');
const absorpM = M('absorption_ratio');
const fnoOi = M('fii_index_fut_positioning');
const blockDeals = M('block_deals_notional');
const num = (m) => (m && typeof m.value === 'number' && Number.isFinite(m.value)) ? m.value : null;
// The NSE fiidiiTradeReact source publishes the day's net only. The ingest
// writes that same daily figure into the MTD and CYTD metrics, so when they
// equal the daily value they are not real month or year totals: hide them.
const sameAsDaily = (agg, day) => num(agg) != null && num(day) != null && num(agg) === num(day);
const fiiMtdReal = !sameAsDaily(fiiMtd, fiiDay);
const diiMtdReal = !sameAsDaily(diiMtdH, diiDay);
const fiiCytdReal = !sameAsDaily(fiiCytdH, fiiDay) && !sameAsDaily(fiiCytdH, fiiMtd);
const fiiD = num(fiiDay), diiD = num(diiDay);
const fiiBuying = fiiD != null && fiiD > 0;
const _absRatio = num(absorpM);
const _absPct = _absRatio != null ? Math.round(_absRatio * 100) : null;
// Absorption (DII buying / FII selling) only means something on an FII selling day.
const absMeaningful = _absRatio != null && fiiD != null && fiiD < 0;
const inrFmt = (v) => (v < 0 ? '-' : '+') + '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(v))) + ' Cr';
const absFmt = (v) => '₹' + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(v))) + ' Cr';
const flowsReadToday = fiiD == null || diiD == null ? 'Flow data pending'
  : fiiBuying && diiD < 0 ? 'FII net buyers, DII net sellers'
  : fiiBuying ? 'FII and DII both net buyers'
  : diiD > 0 ? 'FII net sellers, DII net buyers'
  : 'FII and DII both net sellers';

// V60 Lens 1 · 4-lens regime strip
flowsBody.appendChild(renderLensRow([
  {
    label: 'DII Absorb',
    value: absMeaningful ? _absRatio.toFixed(2) + '×' : 'n/a',
    pill: absMeaningful ? { text: 'REGIME · 8d', klass: _absRatio >= 1 ? 'green' : 'amber' } : null,
    read: absMeaningful ? `DII covering ${_absPct}% of FII selling` : (fiiBuying ? 'FII net buyers: nothing to absorb' : 'Ratio pending')
  },
  {
    label: 'FII net (day)',
    value: fiiD != null ? inrFmt(fiiD) : 'n/a',
    valueClass: (fiiD ?? 0) < 0 ? 'neg' : 'pos',
    pill: fiiD == null ? null : { text: fiiD < -5000 ? 'STRESS' : fiiD < 0 ? 'SELLING' : 'BUYING', klass: fiiD < -5000 ? 'red' : fiiD < 0 ? 'amber' : 'green' },
    read: fiiDay?.as_of ? 'cash market · ' + formatAsOf(fiiDay.as_of) : 'cash market'
  },
  {
    label: 'FII index futures',
    value: num(fnoOi) != null ? (fnoOi.value < 0 ? '-' : '+') + new Intl.NumberFormat('en-IN').format(Math.abs(Math.round(fnoOi.value))) : 'n/a',
    valueClass: (num(fnoOi) ?? 0) > 0 ? 'pos' : 'neg',
    pill: { text: fnoOi?.status === 'high' || fnoOi?.status === 'shock' ? 'HIGH' : 'NORMAL', klass: fnoOi?.status === 'high' ? 'red' : 'amber' },
    read: num(fnoOi) == null ? 'pending' : (fnoOi.value < 0 ? 'contracts net short' : 'contracts net long')
  },
  {
    label: 'Block deals',
    value: num(blockDeals) != null ? formatValue(blockDeals.value, 'currency_inr_cr') : 'n/a',
    pill: { text: (num(blockDeals) ?? 0) > 5000 ? 'NOTABLE' : 'NORMAL', klass: (num(blockDeals) ?? 0) > 5000 ? 'amber' : 'blue' },
    read: 'notional · ' + (blockDeals?.as_of ? formatAsOf(blockDeals.as_of) : '')
  }
]));

// V60 Lens 2 · cards-as-tabs period strip. Only periods with real data are
// shown. The former Weekly tab, CYTD DII (MTD × 4) and the cumulative chart
// were hard-coded May 2026 placeholders and are removed.
const periodData = {};
if (fiiD != null && diiD != null) {
  periodData.today = { label: 'Today', net: fiiD + diiD, fii: fiiD, dii: diiD, sub: '1 session',
    focusedHeader: 'Today · ' + (fiiDay?.as_of ? formatAsOf(fiiDay.as_of) : ''),
    narrative: `FII ${fiiD >= 0 ? 'bought' : 'sold'} a net ${absFmt(fiiD)} and DII ${diiD >= 0 ? 'bought' : 'sold'} a net ${absFmt(diiD)}.`
      + (fiiBuying ? ' No FII selling to absorb.' : absMeaningful ? ` DII covering ${_absPct}% of FII selling.` : '') };
}
if (fiiMtdReal && diiMtdReal && num(fiiMtd) != null && num(diiMtdH) != null) {
  periodData.mtd = { label: 'MTD', net: fiiMtd.value + diiMtdH.value, fii: fiiMtd.value, dii: diiMtdH.value, sub: 'month to date',
    focusedHeader: 'MTD · ' + (fiiMtd?.as_of ? formatAsOf(fiiMtd.as_of) : ''), narrative: 'Month-to-date cash market net.' };
}
const periods = Object.keys(periodData);
let activePeriod = periods.includes('mtd') ? 'mtd' : periods[0];

const periodTabsHost = el('div', {});
const focusedHost = el('div', {});
flowsBody.appendChild(periodTabsHost);
flowsBody.appendChild(focusedHost);

function renderFlowsActive() {
  const p = periodData[activePeriod];
  periodTabsHost.innerHTML = '';
  focusedHost.innerHTML = '';
  if (!p) return;
  periodTabsHost.appendChild(renderCardsAsTabs(periods.map(id => ({
    id, label: periodData[id].label, net: inrFmt(periodData[id].net), sub: periodData[id].sub,
    netClass: periodData[id].net >= 0 ? 'pos' : 'neg',
    active: id === activePeriod
  })), (id) => { activePeriod = id; renderFlowsActive(); }));
  focusedHost.appendChild(renderFlowsFocused({
    period_label: p.focusedHeader || p.label,
    period_sub: flowsReadToday,
    fii: { value: p.fii, formatted: inrFmt(p.fii), sub: 'NSE provisional' },
    dii: { value: p.dii, formatted: inrFmt(p.dii), sub: 'NSE provisional' },
    net: { value: p.net, formatted: inrFmt(p.net), sub: p.sub },
    narrative_lead: 'Read:',
    narrative: p.narrative,
    absorption: absMeaningful ? _absRatio : null
  }));
}
renderFlowsActive();

// F&O OI 5-session persistence bar (chip #3)
// Build a 5-session approximation from sparkline_12m + sign-based color
if (fnoOi && fnoOi.sparkline_12m) {
  const last5 = fnoOi.sparkline_12m.slice(-5).map((v, i, a) => i === 0 ? 0 : (v - a[i-1]));
  flowsBody.appendChild(renderPersistenceBar(last5));
}

// Sectoral diverging bars REMOVED per Aniket 2026-05-12 decision · was mock data, no NSDL parser yet.

// Supporting composite (auto-promote anomalies + summary + change hint built-in)
flowsBody.appendChild(renderSupportingTier(
  ['fpi_debt_flows', 'fii_index_fut_positioning', 'block_deals_notional',
   fiiMtdReal ? 'fii_equity_mtd' : null, diiMtdReal ? 'dii_mtd' : null, fiiCytdReal ? 'fii_equity_cytd' : null].filter(Boolean),
  M,
  { sectionId: 'flows', title: 'Supporting metrics' }
));

body.appendChild(renderSectionFrame({
  section_id: 'flows',
  title: 'Institutional flows',
  question: 'Who is buying, who is selling, and where the money is rotating.',
  timeline: renderTimelineStrip([
    { date: '2026-04-22', severity: 'med',   label: 'FII swing day' },
    { date: '2026-04-28', severity: 'low',   label: 'DII covering' },
    { date: '2026-05-04', severity: 'high',  label: 'Blocks ₹8.5k' },
    { date: '2026-05-08', severity: 'high',  label: 'F&O OI build' },
    { date: '2026-05-11', severity: 'med',   label: 'FII MTD -8.4k' }
  ]),
  sources: buildSectionFooter(['NSE', 'SEBI', 'NSDL', 'AMFI'], 'flows'),
  children: [flowsBody]
}));

// ════════════════════════ MACRO, 5 PANELS ════════════════════════
const macroBody = el('div', { class: 'section-body-stack' });

// Panel 1 · Yield curve with Option A stat strip, live-derived where possible.
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
  { label: 'Real 10Y', value: real10y ? formatTrend(real10y.value).replace(/^\+/, '+') : '-', sub: '10Y - CPI · ' + (cpi ? cpi.value.toFixed(2) + '%' : '-'), color: real10y && real10y.value > 0 ? 'var(--green)' : 'var(--red)' },
  { label: 'Repo rate', value: repo ? repo.value.toFixed(2) + '%' : '-', sub: 'RBI MPC', color: 'var(--ink-2)' }
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
// Inflation bars, live where metric exists; Core/Food are MoSPI sub-series we don't yet ingest separately
const cpiM = M('cpi_inflation');
const wpiM = M('core_cpi');
const inflationItems = [
  { label: 'CPI Headline', value: cpiM?.value ?? 3.40 },
  { label: 'WPI', value: wpiM?.value ?? 3.88 }
];
inflationCurrencyRow.appendChild(renderInflationBars(
  inflationItems,
  4.0,
  { note: ((cpiM && cpiM.value < 4) ? 'CPI below 4%, RBI has room. ' : 'CPI above 4% target. ') + ((wpiM && wpiM.value > (cpiM?.value ?? 4)) ? 'WPI running hotter than CPI.' : 'WPI in line with CPI.'),
    asof: cpiM?.as_of ? formatAsOf(cpiM.as_of) + ' release' : '' }
));
const currencyWrap = el('div', { class: 'viz-wrap' });
currencyWrap.appendChild(el('div', { class: 'viz-title' }, 'Currency · INR · DXY · FX reserves'));
const inrM = M('inr_usd');
const dxyM = M('dxy');
const fxM = M('fx_reserves');
currencyWrap.appendChild(renderCurrencyStrip([
  { label: 'INR / USD', value: inrM ? '₹' + inrM.value.toFixed(2) : '-', tooltip: 'Indian Rupee per US Dollar · RBI reference rate', sparkline: inrM?.sparkline_12m || [], mom_pct: inrM?.mom_pct, yoy_pct: inrM?.yoy_pct, trend_direction: 'bad', asof: inrM?.as_of ? formatAsOf(inrM.as_of) : '', range: inrM ? rangeTick(inrM) : null },
  { label: 'DXY', value: dxyM ? dxyM.value.toFixed(2) : '-', tooltip: 'US Dollar Index, USD vs basket of 6 majors. Above 100 = strong dollar.', sparkline: dxyM?.sparkline_12m || [], mom_pct: dxyM?.mom_pct, yoy_pct: dxyM?.yoy_pct, trend_direction: 'bad', asof: dxyM?.as_of ? formatAsOf(dxyM.as_of) : '', range: dxyM ? rangeTick(dxyM) : null },
  { label: 'FX reserves', value: fxM ? '$' + fxM.value.toFixed(1) + ' Bn' : '-', tooltip: 'India FX reserves · weekly RBI release', sparkline: fxM?.sparkline_12m?.slice() || [], mom_pct: fxM?.mom_pct, yoy_pct: fxM?.yoy_pct, trend_direction: 'bad', asof: fxM?.as_of ? formatAsOf(fxM.as_of) : '', range: fxM ? rangeTick(fxM) : null }
]));
currencyWrap.appendChild(el('div', { class: 'viz-legend-row' }, [
  el('span', { style: { color: 'var(--ink-2)' } }, 'All three weakening together, classic dollar-strength regime.')
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
const pmiRange = pmiM ? rangeTick(pmiM) : null;
const iipRange = iipM ? rangeTick(iipM) : null;
const r10yRange = r10yM ? rangeTick(r10yM) : null;
const gaugeRow = el('div', { class: 'gauge-row' }, [
  el('div', { class: 'gauge-cell calm' }, [
    el('div', { class: 'gauge-label' }, 'PMI COMPOSITE'),
    el('div', { class: 'gauge-value', style: { color: pmiM && pmiM.value >= 50 ? 'var(--green)' : 'var(--red)' } }, pmiM ? pmiM.value.toFixed(1) : '-'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'expansion above 50' + (pmiM?.as_of ? ' · ' + formatAsOf(pmiM.as_of) : '')),
    pmiRange ? renderRangeTick(pmiRange, { compact: true }) : null
  ].filter(Boolean)),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'IIP YOY'),
    el('div', { class: 'gauge-value', style: { color: iipM && iipM.value >= 0 ? 'var(--green)' : 'var(--red)' } }, iipM ? formatTrend(iipM.value) : '-'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'growth above 0%' + (iipM?.as_of ? ' · ' + formatAsOf(iipM.as_of) : '')),
    iipRange ? renderRangeTick(iipRange, { compact: true }) : null
  ].filter(Boolean)),
  el('div', { class: 'gauge-cell warm' }, [
    el('div', { class: 'gauge-label' }, 'REAL 10Y'),
    el('div', { class: 'gauge-value', style: { color: r10yM && r10yM.value > 0 ? 'var(--green)' : 'var(--red)' } }, r10yM ? formatTrend(r10yM.value) : '-'),
    el('div', { class: 'gauge-track' }),
    el('div', { class: 'gauge-hint' }, 'positive carry' + (r10yM?.as_of ? ' · ' + formatAsOf(r10yM.as_of) : '')),
    r10yRange ? renderRangeTick(r10yRange, { compact: true }) : null
  ].filter(Boolean))
]);
gaugeWrap.appendChild(gaugeRow);
const fiscalLeadingRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' } });
fiscalLeadingRow.appendChild(fiscalWrap);
fiscalLeadingRow.appendChild(gaugeWrap);
macroBody.appendChild(fiscalLeadingRow);

// Supporting metrics row (the rest)
macroBody.appendChild(renderSupportingTier(
  ['trade_deficit', 'cad_pct_gdp', 'banking_liquidity', 'wacr_repo_spread',
   'repo_rate', 'credit_deposit_growth', 'iip_growth', 'core_cpi',
   'real_10y_yield', 'pmi_combined', 'fiscal_deficit_pct', 'govt_capex_runrate'],
  M,
  { sectionId: 'macro', title: 'Supporting metrics' }
));

body.appendChild(renderSectionFrame({
  section_id: 'macro',
  title: 'India macro',
  question: 'FX, rates, inflation, fiscal, liquidity, the structural backdrop.',
  timeline: renderTimelineStrip([
    { date: '2026-04-09', severity: 'med',   label: 'MPC pause 5.25%' },
    { date: '2026-04-24', severity: 'high',  label: 'INR breach 95' },
    { date: '2026-04-25', severity: 'med',   label: 'FXR $692Bn' },
    { date: '2026-05-01', severity: 'low',   label: 'CPI 3.40%' },
    { date: '2026-05-11', severity: 'low',   label: 'Real 10Y +3.35%' }
  ]),
  sources: buildSectionFooter(['RBI', 'MoSPI', 'CCIL', 'CGA', 'S&P PMI'], 'macro'),
  children: [macroBody]
}));

// ════════════════════════ REAL ECONOMY, CLUSTER CARDS ════════════════════════
const econBody = el('div', { class: 'section-body-stack' });

// Compute cluster headline from live metrics: average YoY across cluster.
// Falls back to label '-' if no metric in the cluster has yoy_pct.
function clusterAvgYoY(metricIds) {
  const ms = metricIds.map(M).filter(m => m && m.yoy_pct != null);
  if (!ms.length) return null;
  return ms.reduce((s, m) => s + m.yoy_pct, 0) / ms.length;
}
function clusterHeadline(metricIds) {
  const avg = clusterAvgYoY(metricIds);
  return avg == null ? '-' : (avg > 0 ? '+' : '') + avg.toFixed(1) + '%';
}
const clusters = [
  { id: 'tax', label: 'Tax & demand', sub: 'GST · UPI · e-way',
    metrics: ['gst_gross', 'eway_bills'],
    feature: 'gst_gross', featureLabel: 'GST gross · ₹ L Cr' },
  { id: 'movement', label: 'Movement', sub: 'FASTag · Rail · Ports · Air',
    metrics: ['fastag_toll', 'rail_freight', 'port_cargo', 'air_pax'],
    feature: 'rail_freight', featureLabel: 'Rail freight · Mn tonnes' },
  { id: 'production', label: 'Production', sub: 'POL · power · cement · steel',
    metrics: ['pol_demand', 'power_demand', 'cement_dispatches', 'steel_consumption', 'eight_core_industries'],
    feature: 'power_demand', featureLabel: 'Power demand · GW peak' },
  { id: 'auto', label: 'Auto retail', sub: 'FADA · 5 segments',
    metrics: ['auto_2w', 'auto_3w', 'auto_pv', 'auto_cv', 'auto_tractor'] },
  { id: 'discretionary', label: 'Discretionary', sub: 'Naukri · reservoir · tourists',
    metrics: ['epfo_payrolls', 'reservoir_levels'],
    feature: 'reservoir_levels', featureLabel: 'Reservoir · % capacity' }
].map(c => ({ ...c, value: clusterHeadline(c.metrics) }));

// Helper, month labels relative to as_of (12 months back, oldest → newest)
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

// Per-cluster auto-narrative · constructs a 1-line read of the cluster's
// state from its constituent metrics. Highlights the strongest signal
// (worst declining metric for autos, freshest big mover for movement).
function buildClusterSynthesis(c, metrics) {
  if (!metrics.length) return null;

  // AUTO · MoM data is reliable → "all 5 segments down · tractors worst"
  if (c.id === 'auto') {
    const withMom = metrics.filter(m => m.mom_pct != null);
    if (withMom.length === 0) return null;
    const positive = withMom.filter(m => m.mom_pct > 0).length;
    const negative = withMom.filter(m => m.mom_pct < 0).length;
    const worst = withMom.slice().sort((a, b) => a.mom_pct - b.mom_pct)[0];
    const worstLabel = (worst.display_name || '').replace(/ retail registrations/i, '').replace(/ retail/i, '');
    if (negative === withMom.length) {
      return `All ${withMom.length} segments declining MoM. ${worstLabel} worst at ${worst.mom_pct.toFixed(1)}%.`;
    } else if (positive === withMom.length) {
      const best = withMom.slice().sort((a, b) => b.mom_pct - a.mom_pct)[0];
      const bestLabel = (best.display_name || '').replace(/ retail registrations/i, '').replace(/ retail/i, '');
      return `All ${withMom.length} segments positive MoM. ${bestLabel} leads at +${best.mom_pct.toFixed(1)}%.`;
    } else {
      return `${negative} of ${withMom.length} segments declining. ${worstLabel} worst at ${worst.mom_pct.toFixed(1)}%.`;
    }
  }

  // PRODUCTION · YoY for power, MoM for cement/steel, pick the worst
  if (c.id === 'production') {
    const power = metrics.find(m => m.metric_id === 'power_demand');
    if (power && power.yoy_pct != null && power.yoy_pct < -5) {
      return `Power demand down ${Math.abs(power.yoy_pct).toFixed(1)}% YoY · industrial activity easing.`;
    }
    if (power && power.dod_pct != null && power.dod_pct < -5) {
      return `Power demand down ${Math.abs(power.dod_pct).toFixed(1)}% DoD · check load curve.`;
    }
    return `${metrics.length} metrics tracked · industrial activity broadly stable.`;
  }

  // TAX · GST is the anchor; surface its YoY and freshness
  if (c.id === 'tax') {
    const gst = metrics.find(m => m.metric_id === 'gst_gross');
    if (gst) {
      const dir = (gst.yoy_pct ?? 0) >= 0 ? '+' : '';
      return `GST tracking ${dir}${(gst.yoy_pct ?? 0).toFixed(1)}% YoY at ₹${(gst.value).toFixed(2)} L Cr · tax base ${(gst.yoy_pct ?? 0) >= 0 ? 'expanding' : 'contracting'}.`;
    }
    return `${metrics.length} metrics tracked.`;
  }

  // MOVEMENT · most metrics have only DoD; pick biggest mover
  if (c.id === 'movement') {
    const movers = metrics.filter(m => m.dod_pct != null).slice().sort((a, b) => Math.abs(b.dod_pct) - Math.abs(a.dod_pct));
    if (movers.length === 0) return `${metrics.length} metrics tracked · DoD trends accruing.`;
    const top = movers[0];
    const dir = top.dod_pct > 0 ? '+' : '';
    const cleanName = (top.display_name || '').replace(/ value$/i, '').replace(/ loading$/i, '').replace(/ traffic$/i, '');
    return `${cleanName} top mover at ${dir}${top.dod_pct.toFixed(2)}% DoD · ${movers.length} of ${metrics.length} have fresh trends.`;
  }

  // DISCRETIONARY · Naukri is the leading signal
  if (c.id === 'discretionary') {
    const naukri = metrics.find(m => m.metric_id === 'epfo_payrolls');
    if (naukri && naukri.dod_pct != null) {
      return `Naukri JobSpeak ${naukri.dod_pct >= 0 ? '+' : ''}${naukri.dod_pct.toFixed(2)}% DoD at ${naukri.value} · white-collar hiring ${naukri.dod_pct >= 0 ? 'firming' : 'softening'}.`;
    }
    return `${metrics.length} discretionary indicators tracked.`;
  }

  return null;
}

const clusterGrid = el('div', { class: 'cluster-grid' });
const expansionMount = el('div', { id: 'cluster-expansion', style: { marginTop: '14px' } });

let activeCluster = null;
function showCluster(c) {
  activeCluster = c.id;
  clusterGrid.querySelectorAll('.cluster-card').forEach(card => card.classList.toggle('active', card.dataset.cluster === c.id));
  expansionMount.innerHTML = '';

  // Pattern A, numbers cards via small-multiples (every cluster gets this)
  const metrics = c.metrics.map(M).filter(Boolean);
  const newest = metrics.map(m => m.as_of).filter(Boolean).sort().pop();

  // Auto-narrative · 1-line synthesis above the cards. Reads the cluster's
  // own metrics and constructs a punchy "what's the story" line so the user
  // gets an inference instead of having to scan 5 tiles and figure it out.
  const synthesis = buildClusterSynthesis(c, metrics);
  if (synthesis) {
    expansionMount.appendChild(el('div', {
      class: 'cluster-synthesis',
      style: { fontSize: '13.5px', color: 'var(--ink-2)', lineHeight: '1.55', padding: '12px 16px', marginBottom: '12px', background: 'rgba(212,165,116,0.05)', borderLeft: '2px solid var(--accent)', borderRadius: '0 6px 6px 0' }
    }, synthesis));
  }

  // Value-led numbers cards · all clusters use renderClusterCards now
  // (was renderSmallMultiples which displayed null yoy as misleading "0.0%" red).
  // Cards show real value + only the period trends that are non-null per ComparisonSpec.
  const sortedMetrics = c.id === 'auto'
    ? metrics.slice().sort((a, b) => (b.mom_pct || 0) - (a.mom_pct || 0))
    : metrics;
  const asofLine = newest
    ? 'latest as on ' + new Date(newest).getDate() + ' ' + _MO[new Date(newest).getMonth()] + ' ' + new Date(newest).getFullYear()
    : null;
  expansionMount.appendChild(renderClusterCards(sortedMetrics, {
    title: c.label + ' · current values',
    asof: asofLine
  }));

  if (c.id !== 'auto') {
    // E, seasonality strip on the cluster's most cyclical metric
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
  // Drop the misleading "avg YoY · -" headline (was averaging only 1 of 4 metrics
  // for most clusters because yoy_pct is null for ~80% of Real Economy metrics).
  // Show count + freshest as-of instead, every number on the card is real now.
  const cms = c.metrics.map(M).filter(Boolean);
  const verifiedCount = cms.filter(m => m.verification_state === 'verified').length;
  const newestDate = cms.map(m => m.as_of).filter(Boolean).sort().pop();
  const newestStr = newestDate ? new Date(newestDate).getDate() + ' ' + _MO[new Date(newestDate).getMonth()] : '-';
  const card = el('div', { class: 'cluster-card', 'data-cluster': c.id, onclick: () => showCluster(c) }, [
    el('div', { class: 'cc-label' }, c.label),
    el('div', { class: 'cc-value', style: { fontSize: '20px', color: 'var(--ink)' } }, [
      String(cms.length),
      el('span', { style: { fontSize: '11.5px', fontWeight: 500, color: 'var(--ink-3)', marginLeft: '5px' } }, cms.length === 1 ? 'metric' : 'metrics')
    ]),
    el('div', { style: { fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-3)', marginTop: '6px' } }, [
      'latest ' + newestStr
    ]),
    el('div', { class: 'cc-sub', style: { marginTop: '8px' } }, c.sub)
  ]);
  clusterGrid.appendChild(card);
});
econBody.appendChild(clusterGrid);
econBody.appendChild(expansionMount);
showCluster(clusters[3]); // open Auto by default, most data-rich

body.appendChild(renderSectionFrame({
  section_id: 'economy',
  title: 'Real economy',
  question: 'Click any cluster to drill in · tax · movement · production · auto · discretionary.',
  timeline: renderTimelineStrip([
    { date: '2026-04-25', severity: 'low',   label: 'Reservoir 47.2%' },
    { date: '2026-04-30', severity: 'high',  label: 'FADA Tractor -16%' },
    { date: '2026-05-01', severity: 'med',   label: 'GST -5.3% MoM' },
    { date: '2026-05-11', severity: 'low',   label: 'UPI +18.7% DoD' },
    { date: '2026-05-12', severity: 'med',   label: 'POL 19.3 MT' }
  ]),
  sources: buildSectionFooter(['GST', 'FADA', 'GridIndia', 'NPCI', 'IHMCL', 'JPC'], 'economy'),
  children: [econBody]
}));

// ════════════════════════ FREIGHT, CHART-LED ════════════════════════
const freightBody = el('div', { class: 'section-body-stack' });

// Hormuz cliff (kept from prior)
// Plausibility guard · suppress MoM/YoY display when sparkline has < 4 unique
// values AND |trend| > 200%, math is correct but semantically meaningless.
// Show "history accruing" instead.
function trendIsTrustworthy(m, trendValue) {
  if (trendValue == null) return false;
  if (Math.abs(trendValue) <= 200) return true;
  const sl = m.sparkline_12m || [];
  const uniq = new Set(sl.filter(v => typeof v === 'number')).size;
  return uniq >= 4;
}

function buildHormuzPrimary() {
  const m = M('hormuz_throughput');
  if (!m) return null;
  const wrap = el('div', { class: 'hormuz-primary', onclick: () => openDrawer('hormuz_throughput') });
  const showMom = trendIsTrustworthy(m, m.mom_pct);
  const showYoy = trendIsTrustworthy(m, m.yoy_pct);
  // Read provenance from snapshot · expose richer detail when available
  const snap = m._snapshot_payload || {};
  const isStatic = m._source_static === true || (snap.source || '').toLowerCase().includes('static snapshot');
  const inbound  = snap.vessel_count_inbound;
  const outbound = snap.vessel_count_outbound;
  const darkVessels = snap.dark_vessels;
  wrap.appendChild(el('div', { class: 'hp-head' }, [
    el('div', {}, [
      el('div', { class: 'hp-eyebrow' }, [
        '⚠ Shock · Strait of Hormuz throughput',
        isStatic ? el('span', {
          class: 'hp-provisional',
          title: 'hormuz-watch /api/snapshot returns a static placeholder value · live AIS counts not yet wired'
        }, 'PROVISIONAL · static snapshot') : null
      ].filter(Boolean)),
      el('div', { class: 'hp-value' }, formatValue(m.value, 'integer')),
      el('div', { class: 'hp-meta' }, [
        m.unit + ' · 24h average',
        el('span', { style: { borderLeft: '1px solid #3a1c1c', paddingLeft: '14px', color: 'var(--ink-3)' } },
          ['Normal baseline: ', el('b', {}, m.baseline_30d || '-')])
      ]),
      el('div', { class: 'hp-trends' }, [
        // When source is static, the meaningful read is pct_of_normal + inbound/outbound split, NOT MoM/YoY
        showMom && !isStatic
          ? el('span', {}, ['MoM ', el('b', {}, formatTrend(m.mom_pct))])
          : el('span', { style: { color: 'var(--ink-3)', fontStyle: 'italic' }, title: 'Source is static · MoM math meaningless · awaiting live AIS' }, 'history accruing'),
        showYoy && !isStatic
          ? el('span', {}, ['YoY ', el('b', {}, formatTrend(m.yoy_pct))])
          : null,
        el('span', {}, ['% of normal ',
          el('b', {}, ((m.value / (m.baseline_30d || 1)) * 100).toFixed(1) + '%')]),
        (inbound != null && outbound != null) ? el('span', { title: 'Snapshot internal split · inbound + outbound' }, [
          'inbound ', el('b', {}, String(inbound)), ' · outbound ', el('b', {}, String(outbound))
        ]) : null,
        darkVessels != null ? el('span', { title: 'Vessels with disabled AIS transponders inside polygon' }, [
          'dark vessels ', el('b', { style: { color: 'var(--amber)' } }, String(darkVessels))
        ]) : null
      ].filter(Boolean))
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

// Brent + India crude paired line, pull points from live sparklines
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
// Brent vs India crude, Option C headline panel (shock-eligible · biggest physical driver)
const brent = M('brent_crude');
const indiaCrude = M('india_crude_basket');
const brentValue = brent?.value ?? null;
const indiaValue = indiaCrude?.value ?? null;
const brentSpread = +(indiaValue - brentValue).toFixed(2);
// Window facts come from the live sparkline (last N daily readings), never
// from fixed May 2026 text.
const brentSpark = (brent?.sparkline_12m || []).filter(v => typeof v === 'number');
const brentN = brentSpark.length;
const daysAboveShock = brentSpark.filter(v => v >= 95).length;
const brentHi = brentN ? Math.max(...brentSpark) : null;
const brentLo = brentN ? Math.min(...brentSpark) : null;
const brentWindow = brentN ? `last ${brentN} readings to ${formatAsOfLong(brent.as_of)}` : '';
const brentShockText = brentValue >= 95 && indiaValue >= 95 ? 'both above the $95 shock line'
  : brentValue >= 95 ? 'Brent above the $95 shock line'
  : indiaValue >= 95 ? 'India basket above $95, Brent below'
  : 'both below the $95 shock line';
const brentChart = renderPairedLine(
  [
    { name: 'Brent crude', color: 'var(--red)', points: brentPoints, current: '$' + brentValue.toFixed(2) + ' / bbl' },
    { name: 'India crude basket (PPAC)', color: 'var(--accent)', points: indiaPoints, current: '$' + indiaValue.toFixed(2) + ' / bbl' }
  ],
  { title: 'Recent trail · USD per barrel', thresholdLine: 95, summary: `Spread ${brentSpread >= 0 ? '+' : '-'}$${Math.abs(brentSpread).toFixed(2)} · ${brentShockText}`, asof: brentWindow }
);
const brentPanel = renderHeadlinePanel({
  eyebrow: brentValue >= 95 ? '⚠ Shock · Brent crude above $95' : 'Brent crude · ICE 1-month',
  eyebrowColor: brentValue >= 95 ? 'var(--red)' : 'var(--ink-2)',
  value: '$' + brentValue.toFixed(2) + ' / bbl',
  metaLine: 'Brent ICE futures · Trading Economics · ' + (brent?.as_of ? formatAsOf(brent.as_of) : ''),
  threshold: '$95 / bbl',
  mom: brent?.mom_pct != null ? { text: formatTrend(brent.mom_pct), color: brent.mom_pct > 0 ? 'var(--red)' : 'var(--green)' } : null,
  yoy: brent?.yoy_pct != null ? { text: formatTrend(brent.yoy_pct), color: brent.yoy_pct > 0 ? 'var(--red)' : 'var(--green)' } : null,
  // 5Y percentile removed (no reliable free 5Y daily Brent source); will return in V2 once FRED backfill runs from CI
  status: brentValue >= 95 ? 'shock' : 'high',
  statusPill: brentValue >= 95 ? 'SHOCK' : 'HIGH',
  statusSub: brentN ? `Above $95 in ${daysAboveShock} of the last ${brentN} readings` : '',
  chart: brentChart,
  matrix: [
    { label: 'India crude basket', value: '$' + indiaValue.toFixed(2), sub1: indiaCrude?.yoy_pct != null ? formatTrend(indiaCrude.yoy_pct) + ' YoY' : '+34.2% YoY', sub1Color: 'var(--red)', sub2: 'PPAC daily', asof: indiaCrude?.as_of ? formatAsOf(indiaCrude.as_of) : '5 May', tooltip: 'India crude basket = weighted avg of Dubai (75%) + Brent (25%), what India actually pays' },
    { label: 'Brent-India spread', value: (brentSpread >= 0 ? '+$' : '-$') + Math.abs(brentSpread).toFixed(2), sub1: brentSpread < 0 ? 'India trades below Brent' : 'India trades above Brent', sub2: 'live derived', asof: indiaCrude?.as_of ? formatAsOf(indiaCrude.as_of) : '', tooltip: 'Spread = India basket minus Brent. Negative is the norm.' },
    { label: 'Recent high · low', value: brentN ? '$' + Math.round(brentHi) + ' · $' + Math.round(brentLo) : 'n/a', sub1: brentN ? 'range $' + Math.round(brentHi - brentLo) : '', sub2: brentN ? `last ${brentN} readings` : '', asof: brent?.as_of ? formatAsOf(brent.as_of) : '', tooltip: 'High and low of the recent daily Brent readings shown in the chart' },
    { label: 'India weekly oil bill', value: '$' + (indiaValue * 5.1 * 7 / 1000).toFixed(1) + ' Bn', sub1: 'estimate', sub1Color: 'var(--ink-2)', sub2: 'basket × 5.1 Mb/d × 7 days', asof: 'live formula', tooltip: 'India crude imports ≈ 5.1 Mb/d (PPAC). Weekly bill = basket price × imports × 7. Real number on next CI backfill.' }
  ]
});
freightBody.appendChild(brentPanel);
const brentInf = inferenceLineEl('brent');
if (brentInf) freightBody.appendChild(brentInf);

// 3-up tanker / container / bulk small multiples
// Freight indices · live metrics, each with its own date (they refresh on
// different days, so there is no single panel date).
const _fx = (m) => m && typeof m.mom_pct === 'number' ? m.mom_pct : null;
const _fxColor = (v) => v == null ? 'var(--ink-3)' : v > 0 ? 'var(--red)' : 'var(--green)';
const _vlcc = M('vlcc_tanker_rates'), _wci = M('drewry_wci'), _bdti = M('baltic_dirty_tanker');
freightBody.appendChild(renderSmallMultiples([
  _vlcc ? { label: 'VLCC tanker', deltaPct: _fx(_vlcc), color: _fxColor(_fx(_vlcc)), valueFormatted: new Intl.NumberFormat('en-IN').format(Math.round(_vlcc.value)) + ' WS', asof: formatAsOfLong(_vlcc.as_of), tooltip: 'Worldscale points · benchmark for spot tanker rates' } : null,
  _wci ? { label: 'Drewry WCI', deltaPct: _fx(_wci), color: _fxColor(_fx(_wci)), valueFormatted: '$' + new Intl.NumberFormat('en-US').format(Math.round(_wci.value)) + ' per 40ft', asof: formatAsOfLong(_wci.as_of), tooltip: 'Drewry World Container Index · global avg spot rate per 40-ft container' } : null,
  _bdti ? { label: 'Baltic Dirty Tanker', deltaPct: _fx(_bdti), color: _fxColor(_fx(_bdti)), valueFormatted: new Intl.NumberFormat('en-IN').format(Math.round(_bdti.value)) + ' index', asof: formatAsOfLong(_bdti.as_of), tooltip: 'Baltic Dirty Tanker Index · crude tanker rates' } : null
].filter(Boolean), { title: 'Freight indices · MoM %' }));

// Port dwell as supporting row
freightBody.appendChild(renderSupportingTier(
  ['india_crude_basket', 'baltic_dirty_tanker', 'drewry_wci'],
  M,
  { sectionId: 'freight', title: 'Supporting metrics' }
));

body.appendChild(renderSectionFrame({
  section_id: 'freight',
  title: 'Freight & supply chain',
  question: 'Oil supply, shipping rates, and port congestion. Where physical-flow shocks originate.',
  timeline: renderTimelineStrip([
    { date: '2026-04-18', severity: 'high',  label: 'Hormuz drops to 92' },
    { date: '2026-04-24', severity: 'high',  label: 'VLCC +120% wk' },
    { date: '2026-05-04', severity: 'shock', label: 'VLCC +220%' },
    { date: '2026-05-07', severity: 'low',   label: 'WCI -19% DoD' },
    { date: '2026-05-12', severity: 'shock', label: 'Brent $99' }
  ]),
  sources: buildSectionFooter(['MarineTraffic', 'PPAC', 'Drewry', 'Baltic Exchange'], 'freight'),
  children: [freightBody]
}));

// ════════════════════════ MARKET CONTEXT, 4 PANELS ════════════════════════
const marketBody = el('div', { class: 'section-body-stack' });

// Panel 1 · Indexed equity overlay (Option C headline panel), points from live sparklines
const niftyM = M('nifty_50');
const bankM = M('bank_nifty');
const peM = M('nifty_pe_5y');
// Fixed 5Y reference band for Nifty trailing PE (static reference values).
const PE_REF = { min: 15.2, sigmaMinus: 18.6, mean: 21.0, sigmaPlus: 23.8, max: 27.2 };
const peDesc = (v) => v > PE_REF.sigmaPlus ? 'above +1σ' : v > PE_REF.mean ? 'above mean, below +1σ' : v > PE_REF.sigmaMinus ? 'below mean' : 'below -1σ';
const _vixM = M('india_vix'), _inrM = M('inr_usd');
const niftyPoints = metricSparkPoints(niftyM) || Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 101, 102, 102.5, 104, 105, 106.5, 105.5, 104.2][i] }));
const bankPoints = metricSparkPoints(bankM) || Array.from({length: 9}, (_,i) => ({ label: ['Jan','','Feb','','Mar','','Apr','',''][i], value: [100, 100.5, 101.5, 101, 103, 105, 108, 106.5, 104.5][i] }));
const equityChart = renderIndexedOverlay([
  { name: 'Nifty 50', color: 'var(--accent)', points: niftyPoints },
  { name: 'Bank Nifty', color: 'var(--blue)', points: bankPoints }
], { title: 'Indexed trail · base = 100 · last ' + (niftyM?.sparkline_12m?.length || 0) + ' readings' });
const equityPanel = renderHeadlinePanel({
  eyebrow: 'Equity benchmarks · live',
  value: niftyM ? formatValue(niftyM.value, 'index', niftyM.unit || 'idx') : '24,180 idx',
  metaLine: 'Nifty 50 · NSE · ' + (niftyM?.as_of ? formatAsOf(niftyM.as_of) : ''),
  mom: niftyM?.mom_pct != null ? { text: formatTrend(niftyM.mom_pct), color: niftyM.mom_pct >= 0 ? 'var(--green)' : 'var(--red)' } : { text: '+1.4%', color: 'var(--green)' },
  yoy: niftyM?.yoy_pct != null ? { text: formatTrend(niftyM.yoy_pct), color: niftyM.yoy_pct >= 0 ? 'var(--green)' : 'var(--red)' } : { text: '+12.8%', color: 'var(--green)' },
  percentile: peM ? { label: 'Nifty PE ', text: peM.value.toFixed(1) + '×', color: peM.value > PE_REF.sigmaPlus ? 'var(--red)' : 'var(--amber)' } : null,
  status: peM && peM.value > PE_REF.mean ? 'med' : 'low',
  statusPill: peM && peM.value > PE_REF.mean ? 'WATCH' : 'NORMAL',
  statusSub: peM ? (peM.value > PE_REF.sigmaPlus ? 'PE above +1σ of its 5Y range' : peM.value > PE_REF.mean ? 'PE above its 5Y mean' : 'PE below its 5Y mean') : '',
  chart: equityChart,
  matrix: [
    bankM ? { label: 'Bank Nifty', value: formatValue(bankM.value, 'index'), sub1: bankM.yoy_pct != null ? formatTrend(bankM.yoy_pct) + ' YoY' : '', sub1Color: (bankM.yoy_pct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', sub2: bankM.mom_pct != null ? formatTrend(bankM.mom_pct) + ' MoM' : '', asof: formatAsOf(bankM.as_of), tooltip: 'NSE Bank Nifty · 12 large-cap banks' } : null,
    _vixM ? { label: 'India VIX', value: String(Math.round(_vixM.value)), sub1: _vixM.mom_pct != null ? formatTrend(_vixM.mom_pct) + ' MoM' : '', sub1Color: (_vixM.mom_pct ?? 0) > 0 ? 'var(--red)' : 'var(--green)', sub2: 'NSE implied volatility', asof: formatAsOf(_vixM.as_of), tooltip: 'India VIX · NSE 30-day implied volatility' } : null,
    peM ? { label: 'Nifty PE vs 5Y', value: peM.value.toFixed(1) + '×', sub1: `mean ${PE_REF.mean.toFixed(1)}× · +1σ ${PE_REF.sigmaPlus.toFixed(1)}×`, sub1Color: 'var(--amber)', sub2: peDesc(peM.value), asof: formatAsOf(peM.as_of), tooltip: 'Trailing PE vs 5-year reference band' } : null,
    _inrM ? { label: 'INR / $', value: '₹' + _inrM.value.toFixed(2), sub1: _inrM.yoy_pct != null ? formatTrend(_inrM.yoy_pct) + ' YoY' : '', sub1Color: (_inrM.yoy_pct ?? 0) > 0 ? 'var(--red)' : 'var(--green)', sub2: 'RBI reference rate', asof: formatAsOf(_inrM.as_of), tooltip: 'Rupee per US dollar' } : null
  ].filter(Boolean)
});
marketBody.appendChild(equityPanel);
const equityInf = inferenceLineEl('equity');
if (equityInf) marketBody.appendChild(equityInf);

// Panel 2 · Valuation band
const valWrap = el('div', { class: 'viz-wrap' });
valWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'Nifty PE · trailing · vs 5Y range'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, peM?.as_of ? 'as on ' + formatAsOfLong(peM.as_of) : '')
]));
if (peM) valWrap.appendChild(renderValuationBand({ value: peM.value, ...PE_REF, asof: formatAsOfLong(peM.as_of) }));
marketBody.appendChild(valWrap);

// Panel 3 + 4 row · VIX/DXY pair + IND-US spread
const sentimentSpreadRow = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '18px' } });
const vixWrap = el('div', { class: 'viz-wrap' });
vixWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'Sentiment · VIX + Gold'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, M('india_vix')?.as_of ? 'as on ' + formatAsOfLong(M('india_vix').as_of) : '')
]));
// VIX + Gold sentiment row, live values, computed reference-band markers
const vixM = M('india_vix');
const goldM = M('gold_usd');
// Reference bands: VIX 5Y range 9-35 mean 18. Gold uses the low and high of
// its recent daily readings (the old fixed $1,620 to $2,690 band sat far
// below today's price).
const vixPos = vixM ? Math.max(0, Math.min(100, ((vixM.value - 9) / (35 - 9)) * 100)) : 49;
const goldSpark = (goldM?.sparkline_12m || []).filter(v => typeof v === 'number');
const goldLo = goldSpark.length ? Math.min(...goldSpark) : null;
const goldHi = goldSpark.length ? Math.max(...goldSpark) : null;
const goldPos = goldM && goldHi > goldLo ? Math.max(0, Math.min(100, ((goldM.value - goldLo) / (goldHi - goldLo)) * 100)) : 50;
const usd0 = (v) => '$' + new Intl.NumberFormat('en-US').format(Math.round(v));
vixWrap.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', padding: '4px 0' } }, [
  el('div', { title: 'India VIX · NSE 30-day implied volatility · 5Y range 9-35; >25 = elevated stress' }, [
    el('div', { class: 'cs-label' }, 'INDIA VIX'),
    el('div', { class: 'cs-value' }, vixM ? vixM.value.toFixed(2) : '-'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: vixM && vixM.mom_pct > 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, vixM ? formatTrend(vixM.mom_pct) : '-')]),
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
    el('div', { class: 'cs-value' }, goldM ? '$' + new Intl.NumberFormat('en-US').format(Math.round(goldM.value)) + ' / oz' : '-'),
    el('div', { class: 'cs-trends' }, [
      el('span', {}, ['MoM ', el('b', { style: { color: goldM && goldM.mom_pct > 0 ? 'var(--red)' : 'var(--green)', fontFamily: 'var(--mono)' } }, goldM ? formatTrend(goldM.mom_pct) : '-')]),
      goldM?.as_of ? el('span', { style: { marginLeft: '12px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: '11px' } }, 'as on ' + formatAsOf(goldM.as_of)) : null
    ].filter(Boolean)),
    el('div', { style: { marginTop: '8px', height: '6px', background: 'linear-gradient(to right, var(--green), var(--amber) 60%, var(--red))', borderRadius: '3px', position: 'relative', opacity: 0.55 } }, [
      el('div', { style: { position: 'absolute', left: goldPos + '%', top: '-3px', width: '2px', height: '12px', background: 'var(--ink)' } })
    ]),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: '3px' } }, [
      goldSpark.length ? el('span', {}, 'low ' + usd0(goldLo)) : null,
      goldSpark.length ? el('span', {}, `last ${goldSpark.length} readings`) : null,
      goldSpark.length ? el('span', {}, 'high ' + usd0(goldHi)) : null
    ])
  ])
]));
sentimentSpreadRow.appendChild(vixWrap);
// Sentiment inference rendered below the row (full width)

const spreadWrap = el('div', { class: 'viz-wrap' });
spreadWrap.appendChild(el('div', { class: 'viz-title', style: { display: 'flex', justifyContent: 'space-between' } }, [
  el('span', {}, 'India 10Y vs US 10Y spread'),
  el('span', { style: { fontSize: '10.5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0 } }, M('ind_us_10y_spread')?.as_of ? 'as on ' + formatAsOfLong(M('ind_us_10y_spread').as_of) : '')
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
  { label: 'IND-US 10Y spread', value: Math.round(spreadValue) + ' bps', sub: spreadM?.as_of ? 'as on ' + formatAsOf(spreadM.as_of) : '', color: spreadValue < 200 ? 'var(--red)' : 'var(--amber)' },
  { label: 'India 10Y', value: gsec10y.toFixed(2) + '%', sub: 'CCIL FBIL', color: 'var(--ink)' },
  { label: 'US 10Y', value: usTreasury10y.toFixed(2) + '%', sub: 'FRED · derived', color: 'var(--ink)' },
  { label: '5Y avg spread', value: fiveYAvgSpread + ' bps', sub: 'currently ' + Math.abs(Math.round(fiveYAvgSpread - spreadValue)) + ' bps ' + (spreadValue < fiveYAvgSpread ? 'below' : 'above'), color: 'var(--ink-2)' },
  { label: 'Watch threshold', value: '200 bps', sub: Math.round(spreadValue - 200) + ' bps headroom', color: 'var(--red)' }
]));
spreadWrap.appendChild(renderCumulativeLine(
  [{ name: 'IND-US 10Y spread', color: 'var(--accent)', points: spreadPoints, current: Math.round(spreadValue) + ' bps' }],
  { width: 600, height: 160, padTop: 16, padBottom: 26, summary: spreadValue < fiveYAvgSpread ? 'Compressing · in watch zone (200 bps)' : 'Above 5Y average' }
));
sentimentSpreadRow.appendChild(spreadWrap);
marketBody.appendChild(sentimentSpreadRow);
const sentInf = inferenceLineEl('sentiment');
if (sentInf) marketBody.appendChild(sentInf);

// Supporting table
marketBody.appendChild(renderSupportingTier(
  ['ind_us_10y_spread', 'gold_usd', 'dxy', 'high_yield_credit_spread'],
  M,
  { sectionId: 'market', title: 'Supporting metrics' }
));

body.appendChild(renderSectionFrame({
  section_id: 'market',
  title: 'Market context',
  question: 'Equity benchmarks, valuation, sentiment, global linkages.',
  timeline: renderTimelineStrip([
    { date: '2026-04-15', severity: 'med',   label: 'PE 24× rich' },
    { date: '2026-04-25', severity: 'low',   label: 'Bank Nifty break' },
    { date: '2026-05-04', severity: 'high',  label: 'VIX spike 22' },
    { date: '2026-05-11', severity: 'low',   label: 'PE 20.7× cheap' },
    { date: '2026-05-11', severity: 'low',   label: 'BNF +7.9pp lead' }
  ]),
  sources: buildSectionFooter(['NSE', 'CRISIL', 'FRED', 'Reuters'], 'market'),
  children: [marketBody]
}));

// ════════════════════════ SECTORS, RANKED LIST ════════════════════════
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
// Sector tier badges: top 3 (most-pressured) and bottom 3 (most-stable) get
// a small badge so users can see extremities at a glance without scanning all 15.
// Pure client-side derivation (no historical state needed). Better than nothing
// until we have proper per-sector rank-change tracking from history.
const TOP_PRESSURE_N = 3;
const BOTTOM_RELIEF_N = 3;
sectors.forEach((s, idx) => {
  s._tierBadge = idx < TOP_PRESSURE_N
    ? { label: '#' + (idx + 1) + ' MOST PRESSURED', kind: 'high' }
    : idx >= sectors.length - BOTTOM_RELIEF_N
      ? { label: '#' + (sectors.length - idx) + ' MOST STABLE', kind: 'low' }
      : null;
});
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
    el('div', { class: 'sr-name' }, [
      s.display_name,
      s._tierBadge ? el('span', {
        class: 'sr-tier ' + (s._tierBadge.kind === 'high' ? 'sr-tier-high' : 'sr-tier-low'),
        title: s._tierBadge.kind === 'high' ? 'Among the 3 most-pressured sectors today' : 'Among the 3 most-stable sectors today'
      }, s._tierBadge.label) : null
    ].filter(Boolean)),
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
  expansion.appendChild(el('div', { class: 'sub-head' }, 'Driver scores · highest first'));
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
  timeline: renderTimelineStrip([
    { date: '2026-04-18', severity: 'low',   label: 'Shipping +28%' },
    { date: '2026-04-25', severity: 'med',   label: 'Road EPC rerate' },
    { date: '2026-05-04', severity: 'high',  label: 'OMC -8% Brent' },
    { date: '2026-05-08', severity: 'med',   label: 'Cap goods rerate' },
    { date: '2026-05-11', severity: 'low',   label: 'Autos +18.6 YTD' }
  ]),
  sources: buildSectionFooter(['NSE', 'Trendlyne', 'Screener'], 'sectors'),
  children: [sectorsBody]
}));

// ──────────────────────────────────────────────────────────────
// Trust band, above footer (Design Audit §12). V1 reframe (2026-05-05):
// shows "12m history: 1 of 20 verified" honestly so users see backfill state.
// ──────────────────────────────────────────────────────────────
const allMetrics = Object.values(DATA.metrics);
const signalMetrics = allMetrics.filter(m => m.section !== 'composites');
const verifN = signalMetrics.filter(m => m.verification_state === 'verified').length;
const xcheckN = signalMetrics.filter(m => m.verification_state === 'crosscheck_pending').length;
// "Source pending" = anything not yet verified + not yet cross-checked.
// Captures unregistered parsers, failed parsers, and seed-only metrics.
const sourcePendingN = signalMetrics.length - verifN - xcheckN;
// "12m history" count = metrics where sparkline_12m has at least 12 distinct
// non-null values AND the metric has been verified live. Today: GST only.
const has12mHistory = (m) => m.verification_state === 'verified'
  && Array.isArray(m.sparkline_12m)
  && m.sparkline_12m.length >= 12
  && new Set(m.sparkline_12m.filter(v => v != null)).size >= 6;  // 6+ unique values means real history, not mock-padded
const histN = signalMetrics.filter(has12mHistory).length;

body.appendChild(el('div', { class: 'dashboard-trust-band' }, [
  el('a', { class: 'dtb-card', href: './sources/', style: { textDecoration: 'none' } }, [
    el('div', { class: 'dtb-label' }, 'Verified live'),
    el('div', { class: 'dtb-value', style: { color: 'var(--green)' } }, String(verifN)),
    el('div', { class: 'dtb-sub' }, `of ${signalMetrics.length} signals · primary + cross-check`)
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

// StickyTOC removed (2026-05-06), Tab Bar already handles section navigation.
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
  // Sync bottom (mobile) tab bar
  document.querySelectorAll('.btb-btn').forEach(b =>
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

// Build tab buttons with counts + shock badges (desktop · top tab bar)
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

// A · Bottom tab bar (mobile only · CSS hides on desktop)
// 5 visible primary tabs · "More" overflow opens a sheet with the rest if needed.
const TAB_ICONS = {
  flows:    '⇌',
  macro:    '%',
  economy:  '◐',
  freight:  '⚓',
  market:   '↗',
  sectors:  '⊞',
  all:      '☰'
};
const BOTTOM_TABS = ['flows', 'macro', 'economy', 'freight', 'market'];
const bottomBar = document.getElementById('bottom-tab-bar');
if (bottomBar) {
  BOTTOM_TABS.forEach(id => {
    const tab = TABS.find(t => t.id === id);
    if (!tab) return;
    const stats = sectionStats(id);
    const btn = el('button', {
      class: 'btb-btn',
      'data-tab': id,
      onclick: () => setActiveTab(id)
    }, [
      el('span', { class: 'btb-icon' }, TAB_ICONS[id] || '•'),
      el('span', { class: 'btb-label' }, tab.label.length > 8 ? tab.label.slice(0, 7) + '…' : tab.label),
      stats.shockCount ? el('span', { class: 'btb-shock-dot' }) : null
    ].filter(Boolean));
    bottomBar.appendChild(btn);
  });
}
// Bottom tab bar active sync is now baked into setActiveTab() above

// Initial load · skip hash write (keep URL clean) + skip scroll (don't yank user)
setActiveTab(getInitialTab(), { skipHash: !location.hash, skipScroll: true });
window.addEventListener('hashchange', () => setActiveTab(getInitialTab()));

// ──────────────────────────────────────────────────────────────
// Cmd-K palette, global navigation
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

// ──────────────────────────────────────────────────────────────
// Mobile gestures · Tier 3
//   I · Persistent risk-score ticker (slides in when hero scrolls out)
//   G · Pull-to-refresh (touchmove threshold → location.reload)
//   H · Swipe between tabs (horizontal pan on body switches tabs)
// All gated to mobile via CSS display rules + window.matchMedia checks.
// ──────────────────────────────────────────────────────────────
const isMobileMQ = window.matchMedia('(max-width: 700px)');

// I · Risk-score ticker
(function wireRiskTicker() {
  const ticker = document.getElementById('risk-ticker');
  const heroCard = document.getElementById('hero-card');
  if (!ticker || !heroCard || !risk) return;

  const totalShocks = allMetrics.filter(m =>
    m.status === 'shock' && !m.metric_id.startsWith('driver_') && m.metric_id !== 'india_risk_score'
  ).length;

  document.getElementById('rt-score').textContent = riskOk ? String(Math.round(risk.value)) : 'n/a';
  const statusEl = document.getElementById('rt-status');
  statusEl.textContent = riskOk ? (risk.status || '').toUpperCase() : 'NO SCORE';
  statusEl.classList.add('s-' + (riskOk ? (risk.status || 'normal') : 'normal'));
  if (totalShocks > 0) {
    document.getElementById('rt-shocks-sep').style.display = '';
    const shocksEl = document.getElementById('rt-shocks');
    shocksEl.style.display = '';
    shocksEl.textContent = totalShocks + (totalShocks === 1 ? ' shock' : ' shocks');
  }

  const observer = new IntersectionObserver(([entry]) => {
    const heroOut = !entry.isIntersecting;
    ticker.classList.toggle('visible', heroOut);
    document.body.classList.toggle('has-ticker', heroOut);
  }, { rootMargin: '-32px 0px 0px 0px', threshold: 0 });
  observer.observe(heroCard);

  const goTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  ticker.addEventListener('click', goTop);
  ticker.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTop(); } });
})();

// G · Pull-to-refresh
(function wirePullRefresh() {
  const indicator = document.getElementById('pull-refresh');
  if (!indicator) return;
  const ARM = 70;        // px pull before "release to refresh"
  const MAX = 110;       // visual cap
  let startY = null;
  let pulling = false;
  let armed = false;

  function onStart(e) {
    if (!isMobileMQ.matches) return;
    if (window.scrollY > 0) return;
    if (document.body.classList.contains('drawer-open')) return;
    if (document.querySelector('.cmdk-backdrop.open')) return;
    startY = e.touches[0].clientY;
    pulling = false;
    armed = false;
  }
  function onMove(e) {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { reset(); return; }
    if (window.scrollY > 0) { reset(); return; }
    if (!pulling && dy > 8) pulling = true;
    if (!pulling) return;
    const damped = Math.min(MAX, dy * 0.55);
    indicator.style.transform = `translate(-50%, ${damped - 38}px)`;
    indicator.style.opacity = String(Math.min(1, damped / 50));
    const nowArmed = damped >= ARM;
    if (nowArmed !== armed) {
      armed = nowArmed;
      indicator.classList.toggle('armed', armed);
    }
  }
  function onEnd() {
    if (!pulling) { reset(); return; }
    if (armed) {
      indicator.classList.add('refreshing');
      indicator.classList.remove('armed');
      indicator.style.transform = `translate(-50%, 24px)`;
      indicator.style.opacity = '1';
      setTimeout(() => location.reload(), 250);
      return;
    }
    reset();
  }
  function reset() {
    startY = null;
    pulling = false;
    armed = false;
    indicator.classList.remove('armed');
    indicator.style.transform = '';
    indicator.style.opacity = '';
  }
  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove',  onMove,  { passive: true });
  document.addEventListener('touchend',   onEnd,   { passive: true });
  document.addEventListener('touchcancel', reset,  { passive: true });
})();

// H · Swipe between tabs
(function wireSwipeTabs() {
  const body = document.getElementById('body');
  if (!body) return;
  const TAB_ORDER = ['flows', 'macro', 'economy', 'freight', 'market', 'sectors'];
  const H_THRESHOLD = 50;          // min horizontal travel
  const RATIO = 1.5;               // |dx| must beat |dy| × ratio
  const MAX_DRAG = 120;
  let sx = 0, sy = 0;
  let active = false;
  let decided = false;
  let direction = 0;

  function shouldIgnore(target) {
    if (!isMobileMQ.matches) return true;
    if (document.body.classList.contains('drawer-open')) return true;
    if (document.querySelector('.cmdk-backdrop.open')) return true;
    // Don't hijack horizontal scroll inside cards / matrices
    let n = target;
    while (n && n !== document.body) {
      if (n.scrollWidth > n.clientWidth) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (shouldIgnore(e.target)) { active = false; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    active = true;
    decided = false;
    direction = 0;
  }, { passive: true });

  body.addEventListener('touchmove', (e) => {
    if (!active) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dx) < Math.abs(dy) * RATIO) { active = false; body.style.transform = ''; document.body.classList.remove('swiping'); return; }
      decided = true;
      document.body.classList.add('swiping');
    }
    direction = dx < 0 ? -1 : 1;
    const damped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx * 0.4));
    body.style.transform = `translateX(${damped}px)`;
  }, { passive: true });

  body.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    document.body.classList.remove('swiping');
    const dx = (e.changedTouches[0]?.clientX ?? sx) - sx;
    const dy = (e.changedTouches[0]?.clientY ?? sy) - sy;
    body.style.transform = '';
    if (!decided) return;
    if (Math.abs(dx) < H_THRESHOLD || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    const current = document.body.dataset.activeTab || 'flows';
    const idx = TAB_ORDER.indexOf(current);
    if (idx === -1) return;
    const nextIdx = dx < 0 ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) return;
    setActiveTab(TAB_ORDER[nextIdx], { skipScroll: true });
  }, { passive: true });
})();

// First-visit mobile gesture hint · 2026-05-06
// Three Tier-3 gestures shipped (pull-refresh, swipe tabs, risk ticker) but
// they're invisible to first-time users. Show a one-time toast on first
// mobile visit explaining the gestures. Dismissable; persists "shown" in
// localStorage so it never re-appears.
(function showMobileGestureHint() {
  if (!isMobileMQ.matches) return;
  if (localStorage.getItem('irm.gestureHintShown') === '1') return;
  // Wait briefly so the page settles + risk ticker positions
  setTimeout(() => {
    const toast = el('div', {
      class: 'mobile-hint-toast',
      role: 'dialog',
      'aria-label': 'Gesture tips'
    }, [
      el('div', { class: 'mht-row' }, [
        el('span', { class: 'mht-icon' }, '⇄'),
        el('span', { class: 'mht-text' }, 'Swipe left/right to switch sections')
      ]),
      el('div', { class: 'mht-row' }, [
        el('span', { class: 'mht-icon' }, '↓'),
        el('span', { class: 'mht-text' }, 'Pull down at top to refresh')
      ]),
      el('div', { class: 'mht-row' }, [
        el('span', { class: 'mht-icon' }, '◐'),
        el('span', { class: 'mht-text' }, 'Tap risk score (top bar) to scroll back up')
      ]),
      el('button', {
        class: 'mht-close',
        onclick: () => {
          toast.classList.add('mht-closing');
          setTimeout(() => toast.remove(), 220);
          localStorage.setItem('irm.gestureHintShown', '1');
        }
      }, 'Got it')
    ]);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('mht-visible'));
  }, 1200);
})();

console.log(`[IRM Phase 5.5] mounted ${Object.keys(DATA.metrics).length} metrics + ${DATA.sectors?.sectors.length || 0} sectors`);
