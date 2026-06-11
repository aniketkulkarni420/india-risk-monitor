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
  baltic_dirty_tanker:      9,   // weekly publish
  drewry_wci:              10,   // weekly
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
  core_cpi:                20,
  net_sip_inflows:         40,  // AMFI ~10th; 40d covers slips
  mf_net_equity_flows:     40,
  eight_core_industries:   75,  // OEA releases M-2 around the 20th
  nifty_pcr:                3,
  gift_nifty:               3,
  credit_deposit_growth:   20,   // fortnightly
  repo_rate:               90,   // changes quarterly at MPC at most
  real_10y_yield:          30,   // derived from CPI (monthly) — was 3d which falsely flagged stale

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
  fii_index_fut_positioning: 4,
  block_deals_notional:     4,
  absorption_ratio:         4,

  // ── Real Economy · varies by source ──
  gst_gross:               35,   // monthly press release
  power_demand:             3,   // GridIndia daily
  fastag_toll:             10,   // IHMCL weekly-ish
  air_pax:                 35,   // DGCA monthly
  rail_freight:            10,   // PIB weekly+monthly
  port_cargo:              30,   // monthly bulletin
  eway_bills:              10,   // GSTN weekly
  pol_demand:              30,   // PPAC monthly
  cement_dispatches:       35,
  steel_consumption:       35,
  epfo_payrolls:           75,  // ~2-month lag release
  reservoir_levels:        10,   // CWC weekly
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

// Tolerance buffer · we only flag STALE when age > cadence × 1.5.
// Without this buffer, monthly metrics get flagged the day after their
// expected refresh (cadence 35d → "STALE 36d") which trains users to ignore
// the badge. 1.5× gives a real "this is genuinely behind" signal.
const TOLERANCE = 1.5;

// Monthly-publication metrics where the next release date is predictable.
// We exempt these from STALE until the publish-by date passes. CPI for example
// is published around the 12th of each month covering the prior month's data.
// Day-of-month after which the previous month's release SHOULD have shipped.
const MONTHLY_PUBLISH_DAY = {
  cpi_inflation:  14,    // MoSPI publishes ~12th
  core_cpi:       16,    // same release day as CPI
  net_sip_inflows: 14,   // AMFI ~10th
  mf_net_equity_flows: 14,
  eight_core_industries: 24,  // OEA ~20th
  iip_growth:     14,    // MoSPI publishes ~12th
  gst_gross:       6,    // PIB publishes ~1st of next month (already-late after 5)
  trade_deficit:  18,    // MoCI publishes ~15th
  pmi_combined:    5,    // S&P publishes ~3rd
};

function nextExpectedRelease(metricId, asOf, now) {
  const day = MONTHLY_PUBLISH_DAY[metricId];
  if (!day) return null;
  const asOfDate = new Date(asOf);
  // Expected release: day-of-month in the month AFTER the as_of period
  const next = new Date(asOfDate.getFullYear(), asOfDate.getMonth() + 2, day);
  return next;
}

// Returns { is_stale, age_days, cadence_days } for a metric.
export function freshnessFor(metricId, asOf, now = new Date()) {
  if (!asOf) return { is_stale: true, age_days: null, cadence_days: null };
  const cadence = CADENCE_DAYS[metricId];
  if (cadence == null) return { is_stale: false, age_days: null, cadence_days: null };
  const age = Math.floor((now - new Date(asOf)) / 86400000);

  // Monthly metrics: not stale until the next expected release date passes.
  // Catches CPI/WPI/IIP that only publish monthly — flagging them at age=cadence
  // would mark them stale BEFORE the next release was due.
  const expected = nextExpectedRelease(metricId, asOf, now);
  if (expected && now < expected) {
    return { is_stale: false, age_days: age, cadence_days: cadence, next_release: expected.toISOString().slice(0,10) };
  }

  return {
    is_stale: age > cadence * TOLERANCE,
    age_days: age,
    cadence_days: cadence
  };
}
