// Per-metric comparison spec · 2026-05-06
// Locks which time-period comparisons render for each metric, per the
// approved spec doc (IRM_Comparison_Spec_And_Tier2_Options.html).
//
// Why this exists: previously every metric tried to display dod/mom/yoy
// regardless of whether they made sense for that metric. CPI inflation
// (a March-31 YoY reading) was being shown with "+0.08% DoD" — pure float
// noise. This spec maps each metric_id → the periods that are actually
// meaningful for that metric.
//
// Values: a subset of ['dod', 'mom', 'yoy']. Empty array = show value
// only (no trend cells). undefined = use default ['mom', 'yoy'].

export const COMPARISON_SPEC = {
  // ─── Composites · score-scale, no period deltas ───
  india_risk_score:           ['dod'],
  driver_oil_physical:        ['dod'],
  driver_freight:             ['dod'],
  driver_institutional_flows: ['dod'],
  driver_india_macro:         ['dod'],
  driver_sector_breadth:      ['dod'],
  driver_real_economy:        ['dod'],

  // ─── Flows · daily flows + cumulatives ───
  fii_equity_daily:    ['mom', 'yoy'],
  dii_daily:           ['mom', 'yoy'],
  absorption_ratio:    [],          // ratio; no period delta makes sense
  fii_index_fut_positioning: ['dod'],
  net_sip_inflows:     ['mom', 'yoy'],
  mf_net_equity_flows: ['mom', 'yoy'],
  fii_equity_mtd:      [],          // cumulative IS the comparison
  dii_mtd:             [],
  fii_equity_cytd:     [],
  fpi_debt_flows:      ['dod'],
  block_deals_notional:['dod'],

  // ─── Macro · drop gibberish DoD on rates/inflation ───
  inr_usd:               ['dod', 'mom', 'yoy'],
  repo_rate:             [],        // doesn't change daily; show value + status
  cpi_inflation:         ['yoy'],   // it IS a YoY rate; DoD is gibberish
  core_cpi:              ['yoy'],   // same
  gsec_curve:            ['mom', 'yoy'],
  real_10y_yield:        ['yoy'],
  pmi_combined:          [],        // show vs-50 baseline (handled in panel)
  iip_growth:            ['yoy'],   // monthly YoY measure
  trade_deficit:         [],        // monthly $Bn cadence
  cad_pct_gdp:           [],        // quarterly
  fx_reserves:           ['dod'],   // weekly change
  banking_liquidity:     [],        // current value + regime
  credit_deposit_growth: ['yoy'],
  wacr_repo_spread:      ['mom', 'yoy'],
  fiscal_deficit_pct:    [],        // YTD progress
  govt_capex_runrate:    [],

  // ─── Real Economy · per cadence (daily / monthly) ───
  gst_gross:                ['mom', 'yoy'],
  power_demand:             ['dod', 'mom', 'yoy'],
  fastag_toll:              ['dod'],
  air_pax:                  ['dod'],
  auto_pv:                  ['mom'],
  auto_2w:                  ['mom'],
  auto_3w:                  ['mom'],
  auto_cv:                  ['mom'],
  auto_tractor:             ['mom'],
  rail_freight:             ['dod'],
  port_cargo:               ['dod'],
  eway_bills:               ['dod'],
  pol_demand:               ['dod'],
  cement_dispatches:        ['dod'],
  steel_consumption:        [],
  epfo_payrolls:            ['mom', 'yoy'],
  reservoir_levels:         ['dod'],

  // ─── Freight · shock metrics ───
  hormuz_throughput:     ['dod', 'mom', 'yoy'],
  brent_crude:           ['dod', 'mom', 'yoy'],
  india_crude_basket:    ['dod', 'mom', 'yoy'],
  vlcc_tanker_rates:     ['mom', 'yoy'],
  baltic_dirty_tanker:   ['wow'],
  nifty_pcr:             ['dod'],
  gift_nifty:            ['dod'],
  eight_core_industries: ['yoy'],
  drewry_wci:            ['mom', 'yoy'],

  // ─── Market ───
  nifty_50:                 ['dod', 'mom', 'yoy'],
  bank_nifty:               ['dod', 'mom', 'yoy'],
  india_vix:                ['dod'],   // YoY misleading; VIX regime-shifts
  nifty_pe_5y:              ['dod', 'mom', 'yoy'],
  ind_us_10y_spread:        ['dod', 'mom', 'yoy'],
  gold_usd:                 ['mom', 'yoy'],
  dxy:                      ['dod', 'mom', 'yoy'],
  high_yield_credit_spread: ['dod'],
};

// Returns the list of period keys to display for a metric. Falls back to
// ['mom','yoy'] for metrics without a spec entry (preserves prior behavior
// for any metric we haven't classified).
export function getDisplayPeriods(metricId) {
  return COMPARISON_SPEC.hasOwnProperty(metricId)
    ? COMPARISON_SPEC[metricId]
    : ['mom', 'yoy'];
}
