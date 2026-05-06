// Per-metric expected_cadence_days · 2026-05-06
// Drives the "STALE" badge in the UI. A metric is flagged stale when
// (today - as_of) > expected_cadence_days × tolerance_factor.
//
// Source-cadence reference (what the underlying source publishes):
//   daily       → 3-day grace (covers weekend gaps)
//   weekday     → 4-day grace (Fri release + Sat/Sun)
//   weekly      → 10-day grace
//   monthly     → 35-day grace
//   quarterly   → 100-day grace
//   intraday    → 2-day grace (hourly intra-day; pages refresh slowly)

export const CADENCE_DAYS = {
  // ── Daily / intraday ──
  hormuz_throughput:        3,    // hormuz-watch · should refresh hourly
  brent_crude:              3,    // EIA daily
  india_crude_basket:       3,    // PPAC daily
  vlcc_tanker_rates:        3,
  baltic_dry_index:         3,
  drewry_wci:              10,   // weekly
  india_port_dwell_time:   10,   // weekly bulletins
  inr_usd:                  3,
  gsec_curve:               3,
  banking_liquidity:        3,
  wacr_repo_spread:         3,
  trade_deficit:           35,   // monthly DGCIS
  govt_capex_runrate:      35,   // CGA monthly accounts
  fiscal_deficit_pct:      35,
  cad_pct_gdp:            100,   // quarterly
  fx_reserves:             10,   // weekly RBI WSS
  pmi_combined:            35,   // monthly
  iip_growth:              45,   // monthly + lag
  cpi_inflation:           20,   // monthly · publishes ~12th of next month
  wpi_inflation:           20,
  credit_deposit_growth:   20,   // fortnightly
  repo_rate:               90,   // changes quarterly at MPC at most
  real_10y_yield:           3,   // derived daily

  // ── Equity / market · daily on weekdays ──
  nifty_50:                 4,
  bank_nifty:               4,
  india_vix:                4,
  nifty_pe_5y:              4,
  ind_us_10y_spread:        4,
  gold_usd:                 4,
  dxy:                      4,
  high_yield_credit_spread: 4,

  // ── Flows · daily on weekdays ──
  fii_equity_daily:         4,
  dii_daily:                4,
  fii_equity_mtd:           4,
  dii_mtd:                  4,
  fii_equity_cytd:          4,
  fpi_debt_flows:           4,
  fno_oi_buildup:           4,
  block_deals_notional:     4,
  absorption_ratio:         4,
  sectoral_fii_mtd:         5,   // NSDL sectoral · sometimes 1-day lag

  // ── Real Economy · varies by source ──
  gst_gross:               35,   // monthly press release
  power_demand:             3,   // GridIndia daily
  fastag_toll:             10,   // IHMCL weekly-ish
  air_pax:                 35,   // DGCA monthly
  rail_freight:            10,   // PIB weekly+monthly
  port_cargo:              30,   // monthly bulletin
  eway_bills:              10,   // GSTN weekly
  upi_value:               10,   // NPCI monthly stats; weekly drip
  pol_demand:              30,   // PPAC monthly
  cement_dispatches:       35,
  steel_consumption:       35,
  naukri_jobspeak:         35,
  reservoir_levels:        10,   // CWC weekly
  foreign_tourist_arrivals: 60,  // MoT lags ~45-60d
  auto_2w:                 35,   // FADA monthly
  auto_3w:                 35,
  auto_pv:                 35,
  auto_cv:                 35,
  auto_tractor:            35,

  // ── Composites · derived daily ──
  india_risk_score:           3,
  driver_oil_physical:        3,
  driver_freight:             3,
  driver_institutional_flows: 3,
  driver_india_macro:         3,
  driver_sector_breadth:      3,
  driver_real_economy:        3,
  institutional_flow_regime:  3,
  real_economy_state:         3,
  supply_chain_state:         3,
};

// Returns { is_stale, age_days, cadence_days } for a metric.
export function freshnessFor(metricId, asOf, now = new Date()) {
  if (!asOf) return { is_stale: true, age_days: null, cadence_days: null };
  const cadence = CADENCE_DAYS[metricId];
  if (cadence == null) return { is_stale: false, age_days: null, cadence_days: null };
  const age = Math.floor((now - new Date(asOf)) / 86400000);
  return {
    is_stale: age > cadence,
    age_days: age,
    cadence_days: cadence
  };
}
