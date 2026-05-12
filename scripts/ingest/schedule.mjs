// Schedule definitions — IST cron slots from IRM_Build_Spec §05.
// Each slot has a list of parser-pattern filters. The orchestrator's --slot
// argument runs every metric whose source_primary.parser starts with one of
// the filter prefixes.

export const SLOTS = {
  daily_06: {
    description: '06:00 IST · overnight global data settled',
    cron: '0 6 * * *',
    metric_ids: [
      // Hand-picked daily metrics that settle overnight
      'hormuz_throughput', 'baltic_dry_index', 'vlcc_tanker_rates',
      'brent_crude', 'gold_usd', 'dxy', 'power_demand'
    ]
  },
  weekday_close: {
    description: '17:00 IST · post-NSE close',
    cron: '0 17 * * 1-5',
    metric_ids: [
      'fii_equity_daily', 'fii_equity_mtd', 'fii_equity_cytd',
      'dii_daily', 'dii_mtd', 'absorption_ratio',
      'fno_oi_buildup', 'block_deals_notional',
      'nifty_50', 'bank_nifty', 'nifty_pe_5y', 'india_vix'
    ]
  },
  weekday_evening: {
    description: '19:00 IST · post-NSDL update',
    cron: '0 19 * * 1-5',
    metric_ids: [
      'fpi_debt_flows',
      'gsec_curve', 'real_10y_yield',
      'banking_liquidity', 'wacr_repo_spread',
      'inr_usd', 'ind_us_10y_spread'
    ]
  },
  fri_17: {
    description: '17:00 Friday · weekly releases',
    cron: '0 17 * * 5',
    metric_ids: [
      'fx_reserves', 'high_yield_credit_spread',
      'drewry_wci', 'india_port_dwell_time',
      'reservoir_levels', 'india_crude_basket'
    ]
  },
  monthly_1: {
    description: '10:00 1st of month · monthly press releases',
    cron: '0 10 1 * *',
    metric_ids: [
      'gst_gross', 'auto_2w', 'auto_3w', 'auto_pv', 'auto_cv', 'auto_tractor',
      'upi_value', 'pol_demand', 'air_pax'
    ]
  },
  monthly_5: {
    description: '10:00 5th of month · mid-month releases',
    cron: '0 10 5 * *',
    metric_ids: [
      'iip_growth', 'wpi_inflation', 'cpi_inflation',
      'naukri_jobspeak', 'cement_dispatches', 'steel_consumption',
      'pmi_combined',
      'eway_bills', 'fastag_toll', 'rail_freight', 'port_cargo',
      'fiscal_deficit_pct', 'govt_capex_runrate', 'credit_deposit_growth'
    ]
  },
  policy_event: {
    description: 'On-demand · MPC release · CAD/BoP release · trade data',
    cron: 'manual',
    metric_ids: ['repo_rate', 'cad_pct_gdp', 'trade_deficit']
  }
};

// Composites — derived metrics that recompute after their inputs update.
// Run last in any orchestrator pass.
export const COMPOSITES = [
  'driver_oil_physical', 'driver_institutional_flows', 'driver_india_macro',
  'driver_real_economy', 'driver_freight', 'driver_sector_breadth',
  'india_risk_score', 'institutional_flow_regime', 'real_economy_state',
  'supply_chain_state'
];

// All daily-cadence metric_ids
export const ALL_DAILY = Array.from(new Set([
  ...SLOTS.daily_06.metric_ids,
  ...SLOTS.weekday_close.metric_ids,
  ...SLOTS.weekday_evening.metric_ids
]));

// Every metric across every slot (manual "ingest everything fresh now" use case)
export const ALL_EVERY = Array.from(new Set(
  Object.values(SLOTS).flatMap(s => s.metric_ids)
));

export function slotFor(name) {
  if (!SLOTS[name]) throw new Error(`unknown slot: ${name}. Available: ${Object.keys(SLOTS).join(', ')}`);
  return SLOTS[name];
}
