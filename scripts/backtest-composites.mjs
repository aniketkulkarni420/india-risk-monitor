// IRM scoring backtest harness · v1 · 2026-05-12
//
// Validates that the v2 composite-recompute logic produces sensible scores
// when fed synthetic "known crisis" inputs. This is NOT a real historical
// backtest — that requires multi-year time series for every feeder, which
// we don't yet have on disk. This harness:
//
//   1. Defines 5 known stress events with literature-derived feeder states
//   2. Builds a synthetic Map<id, metric> matching what ingest would produce
//   3. Runs recomputeComposites() and prints driver + IRS scores
//   4. Compares against expected score (from REFERENCE_EVENTS)
//   5. Fails the run if any event score is more than ±15 points off expected
//
// USAGE
//   node scripts/backtest-composites.mjs
//   node scripts/backtest-composites.mjs --event=2020-covid
//   node scripts/backtest-composites.mjs --verbose
//
// When real multi-year feeder history becomes available (e.g. via FRED /
// dbnomics / TradingEconomics archive pulls), replace SCENARIOS below with
// actual historical snapshots.

import { recomputeComposites, REFERENCE_EVENTS } from './composite-recompute.mjs';

const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose');
const EVENT_FILTER = [...args].find(a => a.startsWith('--event='))?.slice(8);

// ──────────────────────────────────────────────────────────────────
// Scenario synthesis
// ──────────────────────────────────────────────────────────────────
// Each scenario specifies the RAW value + 12m mean + 12m stddev of each
// feeder at the event date. The z-score path inside recompute will turn
// these into 0-100 scores naturally.

function feeder(id, value, mean, stddev, status = 'high') {
  const sparkline_12m = [
    mean - stddev * 1.5, mean - stddev, mean - 0.5 * stddev,
    mean, mean + 0.2 * stddev, mean + 0.5 * stddev,
    mean + 0.3 * stddev, mean + 0.7 * stddev, mean + stddev,
    mean + 1.2 * stddev, mean + 1.5 * stddev, mean + 2 * stddev
  ];
  return {
    metric_id: id,
    value,
    sparkline_12m,
    baseline_30d: mean,
    status,
    last_verified_at: new Date().toISOString()
  };
}

function driver(id) {
  return {
    metric_id: id,
    value: 50,
    sparkline_12m: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    baseline_30d: 50,
    last_verified_at: new Date().toISOString()
  };
}

const SCENARIOS = {
  '2008-lehman': {
    label: 'Lehman / GFC peak',
    expected_irs: 70,
    feeders: [
      // Oil collapsed (Brent $147 → $40), severe FII outflows, INR weakness
      feeder('brent_crude', 140, 80, 15, 'shock'),     // far above mean → high oil-stress
      feeder('india_crude_basket', 138, 82, 14, 'shock'),
      feeder('hormuz_throughput', 17, 19, 1, 'med'),  // not Hormuz-specific event
      feeder('vlcc_tanker_rates', 30000, 25000, 5000, 'high'),
      feeder('drewry_wci', 3500, 2200, 600, 'high'),
      feeder('baltic_dry_index', 11000, 5000, 2000, 'high'),
      feeder('india_port_dwell_time', 4.5, 3.2, 0.6, 'high'),
      feeder('fii_equity_daily', -20000, 500, 6000, 'shock'),  // massive outflow
      feeder('fii_equity_mtd', -45000, 5000, 15000, 'shock'),
      feeder('dii_daily', 18000, 2000, 4000, 'high'),
      feeder('dii_mtd', 32000, 8000, 10000, 'high'),
      feeder('absorption_ratio', 0.85, 1.5, 0.4, 'shock'),
      feeder('inr_usd', 50.5, 44, 2, 'shock'),
      feeder('cpi_inflation', 9.5, 6, 1.5, 'high'),
      feeder('wpi_inflation', 12, 5, 3, 'shock'),
      feeder('iip_growth', -0.5, 8, 3, 'shock'),
      feeder('fiscal_deficit_pct', 6.2, 4.5, 0.5, 'high'),
      feeder('cad_pct_gdp', 4.8, 2.5, 0.8, 'high'),
      feeder('gst_gross', 0, 0, 1, 'neutral'),           // GST didn't exist
      feeder('pmi_combined', 44, 53, 3, 'shock'),
      feeder('steel_consumption', 5.2, 7.5, 0.8, 'high'),
      feeder('auto_2w', 800000, 1100000, 100000, 'high'),
      feeder('rail_freight', 70, 90, 8, 'high')
    ]
  },

  '2013-taper': {
    label: 'Taper tantrum INR low',
    expected_irs: 63,
    feeders: [
      feeder('brent_crude', 110, 105, 8, 'med'),
      feeder('india_crude_basket', 108, 103, 7, 'med'),
      feeder('hormuz_throughput', 19, 19, 1, 'med'),
      feeder('vlcc_tanker_rates', 12000, 12000, 3000, 'med'),
      feeder('drewry_wci', 1900, 1900, 500, 'med'),
      feeder('baltic_dry_index', 1200, 1500, 400, 'med'),
      feeder('india_port_dwell_time', 3.5, 3.2, 0.5, 'med'),
      feeder('fii_equity_daily', -8000, 1000, 4000, 'shock'),
      feeder('fii_equity_mtd', -28000, 8000, 12000, 'shock'),
      feeder('dii_daily', 6000, 2000, 3000, 'high'),
      feeder('dii_mtd', 18000, 8000, 8000, 'high'),
      feeder('absorption_ratio', 0.95, 1.4, 0.3, 'high'),
      feeder('inr_usd', 68.8, 56, 3, 'shock'),
      feeder('cpi_inflation', 10.7, 7, 2, 'shock'),
      feeder('wpi_inflation', 6.2, 5, 1.5, 'med'),
      feeder('iip_growth', -2.0, 5, 2, 'shock'),
      feeder('fiscal_deficit_pct', 5.0, 4.5, 0.5, 'high'),
      feeder('cad_pct_gdp', 4.8, 2.5, 0.7, 'high'),
      feeder('pmi_combined', 48, 52, 2, 'high'),
      feeder('steel_consumption', 6.5, 7.0, 0.5, 'med'),
      feeder('auto_2w', 950000, 1050000, 80000, 'med'),
      feeder('rail_freight', 88, 92, 5, 'med')
    ]
  },

  '2020-covid': {
    label: 'COVID lockdown',
    expected_irs: 60,
    feeders: [
      feeder('brent_crude', 22, 60, 8, 'shock'),       // collapsed
      feeder('india_crude_basket', 20, 58, 8, 'shock'),
      feeder('hormuz_throughput', 18, 19, 1, 'low'),
      feeder('vlcc_tanker_rates', 200000, 30000, 15000, 'shock'),  // storage play
      feeder('drewry_wci', 1100, 1800, 400, 'low'),
      feeder('baltic_dry_index', 500, 1200, 300, 'shock'),
      feeder('india_port_dwell_time', 7, 3.5, 0.8, 'shock'),
      feeder('fii_equity_daily', -16000, 800, 5000, 'shock'),
      feeder('fii_equity_mtd', -62000, 10000, 15000, 'shock'),
      feeder('dii_daily', 14000, 3000, 4000, 'high'),
      feeder('dii_mtd', 55000, 12000, 12000, 'high'),
      feeder('absorption_ratio', 0.88, 1.4, 0.3, 'shock'),
      feeder('inr_usd', 76.5, 71, 2, 'shock'),
      feeder('cpi_inflation', 5.9, 4, 1, 'high'),
      feeder('wpi_inflation', -1.6, 2.5, 1.5, 'low'),
      feeder('iip_growth', -55, 4, 3, 'shock'),
      feeder('fiscal_deficit_pct', 9.2, 4, 1, 'shock'),
      feeder('cad_pct_gdp', 0.5, 1.5, 0.5, 'low'),
      feeder('gst_gross', 32000, 100000, 8000, 'shock'),
      feeder('pmi_combined', 27, 52, 3, 'shock'),
      feeder('steel_consumption', 3.0, 8, 1, 'shock'),
      feeder('auto_2w', 200000, 1500000, 200000, 'shock'),
      feeder('rail_freight', 75, 110, 8, 'shock')
    ]
  },

  '2022-oil': {
    label: 'Russia-Ukraine oil shock',
    expected_irs: 67,
    feeders: [
      feeder('brent_crude', 128, 80, 10, 'shock'),
      feeder('india_crude_basket', 126, 78, 10, 'shock'),
      feeder('hormuz_throughput', 19, 19, 1, 'med'),
      feeder('vlcc_tanker_rates', 75000, 30000, 12000, 'shock'),
      feeder('drewry_wci', 9500, 4500, 1500, 'shock'),
      feeder('baltic_dry_index', 2700, 1500, 400, 'high'),
      feeder('india_port_dwell_time', 4.2, 3.3, 0.6, 'high'),
      feeder('fii_equity_daily', -7500, 800, 4500, 'high'),
      feeder('fii_equity_mtd', -41000, 8000, 12000, 'shock'),
      feeder('dii_daily', 9500, 2500, 3500, 'high'),
      feeder('dii_mtd', 32000, 10000, 10000, 'high'),
      feeder('absorption_ratio', 1.05, 1.4, 0.3, 'high'),
      feeder('inr_usd', 77.5, 74, 1.5, 'high'),
      feeder('cpi_inflation', 7.8, 5, 1.2, 'high'),
      feeder('wpi_inflation', 14.5, 6, 3, 'shock'),
      feeder('iip_growth', 1.7, 5, 2.5, 'high'),
      feeder('fiscal_deficit_pct', 6.4, 4.5, 0.6, 'high'),
      feeder('cad_pct_gdp', 3.0, 1.8, 0.6, 'high'),
      feeder('gst_gross', 142000, 130000, 8000, 'low'),
      feeder('pmi_combined', 53.2, 53, 1.5, 'low'),
      feeder('steel_consumption', 8.8, 8, 0.6, 'low'),
      feeder('auto_2w', 1100000, 1200000, 80000, 'med'),
      feeder('rail_freight', 115, 105, 6, 'low')
    ]
  },

  '2024-election': {
    label: 'Election results day',
    expected_irs: 49,
    feeders: [
      feeder('brent_crude', 78, 82, 5, 'med'),
      feeder('india_crude_basket', 76, 80, 5, 'med'),
      feeder('hormuz_throughput', 19, 19, 0.5, 'low'),
      feeder('vlcc_tanker_rates', 35000, 32000, 6000, 'med'),
      feeder('drewry_wci', 4200, 3800, 600, 'med'),
      feeder('baltic_dry_index', 1900, 1700, 300, 'med'),
      feeder('india_port_dwell_time', 3.6, 3.2, 0.4, 'med'),
      feeder('fii_equity_daily', -12500, 1500, 4500, 'high'),     // election day outflow
      feeder('fii_equity_mtd', -25000, 8000, 12000, 'high'),
      feeder('dii_daily', 13800, 3000, 3500, 'high'),
      feeder('dii_mtd', 28000, 12000, 10000, 'high'),
      feeder('absorption_ratio', 1.10, 1.4, 0.25, 'high'),
      feeder('inr_usd', 83.5, 83, 0.4, 'med'),
      feeder('cpi_inflation', 4.8, 5, 0.5, 'med'),
      feeder('wpi_inflation', 2.6, 3, 0.8, 'low'),
      feeder('iip_growth', 5.0, 5.5, 1.5, 'med'),
      feeder('fiscal_deficit_pct', 5.6, 5.4, 0.3, 'med'),
      feeder('cad_pct_gdp', 1.2, 1.5, 0.4, 'low'),
      feeder('gst_gross', 173000, 165000, 6000, 'low'),
      feeder('pmi_combined', 60.5, 58, 1.5, 'low'),
      feeder('steel_consumption', 9.6, 9, 0.4, 'med'),
      feeder('auto_2w', 1430000, 1300000, 70000, 'low'),
      feeder('rail_freight', 132, 125, 5, 'low')
    ]
  }
};

// ──────────────────────────────────────────────────────────────────
// Driver shells (added before run; recompute mutates these)
// ──────────────────────────────────────────────────────────────────

function buildScenarioMetrics(feeders) {
  const map = new Map();
  for (const f of feeders) map.set(f.metric_id, f);
  for (const id of ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
                    'driver_india_macro', 'driver_real_economy', 'driver_sector_breadth',
                    'india_risk_score']) {
    map.set(id, driver(id));
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────────────────────────

const eventIds = EVENT_FILTER ? [EVENT_FILTER] : Object.keys(SCENARIOS);
let failures = 0;

console.log('IRM v2 scoring backtest · synthetic scenarios');
console.log('='.repeat(70));

for (const eventId of eventIds) {
  const s = SCENARIOS[eventId];
  if (!s) { console.log(`✗ unknown event: ${eventId}`); failures++; continue; }
  const m = buildScenarioMetrics(s.feeders);
  recomputeComposites(m);
  const irs = m.get('india_risk_score');
  const drivers = ['driver_oil_physical', 'driver_freight', 'driver_institutional_flows',
                   'driver_india_macro', 'driver_real_economy', 'driver_sector_breadth']
                  .map(id => ({ id, value: m.get(id)?.value }));

  const delta = irs.value !== null ? Math.abs(irs.value - s.expected_irs) : 100;
  const passed = delta <= 10;
  if (!passed) failures++;

  console.log(`\n${passed ? '✓' : '✗'} ${eventId} · ${s.label}`);
  console.log(`  expected IRS: ${s.expected_irs} · got: ${irs.value} · delta: ${delta}`);
  if (irs.triple_jeopardy?.active) console.log('  triple-jeopardy: ACTIVE');
  if (irs.shock_indicator) console.log(`  shock-indicator: ${irs.shock_direction} ${irs.point_move_30d} pts`);
  if (VERBOSE) {
    for (const d of drivers) console.log(`    ${d.id}: ${d.value}`);
    console.log(`    raw_avg: ${irs.raw_weighted_avg} · adjustment: ${irs.correlation_adjustment}`);
  }
}

console.log('\n' + '='.repeat(70));
console.log(failures === 0 ? `✓ all ${eventIds.length} scenarios within ±15 points` : `✗ ${failures} of ${eventIds.length} scenarios out of band`);
console.log('\nNote: thresholds are calibration targets, not hard PASS/FAIL.');
console.log('Replace synthetic feeders with real historical data when available.');
console.log('See REFERENCE_EVENTS in composite-recompute.mjs for ground truth.');
process.exit(failures > 0 ? 1 : 0);
