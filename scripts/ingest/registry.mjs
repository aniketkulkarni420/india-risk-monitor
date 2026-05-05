// Parser registry — maps parser_id (from metric.source_primary.parser) to a
// parser module that exports { fetchPrimary, fetchCrosscheck }.
//
// If parser_id has no real implementation registered, mock fetcher is used.
// To "go live" on a parser, register it here once its real fetcher passes review.

import * as nse_fii_dii_v1 from './parsers/nse_fii_dii_v1.mjs';
import * as nse_indices_v1 from './parsers/nse_indices_v1.mjs';
import * as rbi_refrate_v1 from './parsers/rbi_refrate_v1.mjs';
import * as public_oil_v1 from './parsers/public_oil_v1.mjs';
import * as gridindia_v1 from './parsers/gridindia_v1.mjs';
import * as pib_press_v1 from './parsers/pib_press_v1.mjs';
import * as fada_monthly_v1 from './parsers/fada_monthly_v1.mjs';
import * as hormuz_v1 from './parsers/hormuz_v1.mjs';
import * as tradingeconomics_v1 from './parsers/tradingeconomics_v1.mjs';
import * as derived_v1 from './parsers/derived_v1.mjs';
import * as mock from './parsers/mock.mjs';

// Registered REAL implementations. Anything not in this map uses mock fetcher.
// Pattern: parser_id (from metric.source_primary.parser) → module exporting { fetchPrimary, fetchCrosscheck }
// Multiple parser_ids can share a parser module (NSE indices, PIB releases).
const REAL = new Map([
  ['csv_download:nse_fii_dii_v1', nse_fii_dii_v1],
  ['csv_download:nse_indices_v1', nse_indices_v1],
  ['csv_download:nse_vix_v1', nse_indices_v1],
  ['csv_download:nse_pe_v1', nse_indices_v1],
  ['json_api:rbi_refrate_v1', rbi_refrate_v1],
  ['json_api:public_oil_v1', public_oil_v1],
  ['json_api:gridindia_v1', gridindia_v1],
  ['press_release:gst_monthly_v1', pib_press_v1],
  ['press_release:mospi_iip_v1', pib_press_v1],
  ['press_release:eaindustry_wpi_v1', pib_press_v1],
  ['press_release:mospi_cpi_v1', pib_press_v1],
  ['press_release:fada_monthly_v1', fada_monthly_v1],
  ['html_scrape:hormuz_v1', hormuz_v1],
  // Trading Economics generic parser — covers commodity + India macro indicators
  ['json_api:public_gold_v1', tradingeconomics_v1],
  ['json_api:public_dxy_v1', tradingeconomics_v1],
  ['html_scrape:tradingeconomics_v1', tradingeconomics_v1],   // baltic_dry_index
  ['press_release:sp_pmi_india_v1', tradingeconomics_v1],     // pmi_combined
  ['press_release:rbi_policy_v1', tradingeconomics_v1],       // repo_rate
  ['press_release:dgcis_v1', tradingeconomics_v1],            // trade_deficit
  ['press_release:rbi_bop_v1', tradingeconomics_v1],          // cad_pct_gdp
  // baltic_dirty_v1 (vlcc_tanker_rates) intentionally not registered until Hormuz tool integration
  // Pure-derived metrics (read peer metric values, no network)
  ['manual:derived_v1', derived_v1],
]);

export function resolve(parser_id, { live = false } = {}) {
  if (live && REAL.has(parser_id)) return { mode: 'live', parser: REAL.get(parser_id), parser_id };
  if (live) return { mode: 'unregistered', parser: null, parser_id };  // honest: skip in live mode
  return { mode: 'mock', parser: mock, parser_id };
}

export function listRealParsers() {
  return Array.from(REAL.keys());
}

export function totalRegistered() {
  return REAL.size;
}
