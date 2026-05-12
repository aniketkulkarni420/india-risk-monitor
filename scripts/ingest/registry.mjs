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
import * as drewry_v1 from './parsers/drewry_v1.mjs';
import * as derived_v1 from './parsers/derived_v1.mjs';
import * as india_govt_v1 from './parsers/india_govt_v1.mjs';
import * as nsdl_sectoral_v1 from './parsers/nsdl_sectoral_v1.mjs';
import * as pib_rss_v1 from './parsers/pib_rss_v1.mjs';
import * as google_news_rss_v1 from './parsers/google_news_rss_v1.mjs';
import * as google_news_llm_v1 from './parsers/google_news_llm_v1.mjs';
import * as pib_search_v1 from './parsers/pib_search_v1.mjs';
import * as yahoo_finance_v1 from './parsers/yahoo_finance_v1.mjs';
import * as ppac_v1 from './parsers/ppac_v1.mjs';
import * as moneycontrol_v1 from './parsers/moneycontrol_v1.mjs';
import * as bse_v1 from './parsers/bse_v1.mjs';
import * as nitter_v1 from './parsers/nitter_v1.mjs';
import * as eaindustry_ieci_v1 from './parsers/eaindustry_ieci_v1.mjs';
import * as web_llm_v1 from './parsers/web_llm_v1.mjs';
import * as publisher_rss_v1 from './parsers/publisher_rss_v1.mjs';
import * as tiered_v1 from './parsers/tiered_v1.mjs';
import * as dbnomics_v1 from './parsers/dbnomics_v1.mjs';
import * as datagovin_v1 from './parsers/datagovin_v1.mjs';
import * as nse_rbi_direct_v1 from './parsers/nse_rbi_direct_v1.mjs';
import * as pdf_v1 from './parsers/pdf_v1.mjs';
import * as playwright_render_v1 from './parsers/playwright_render_v1.mjs';
import * as llm_extract_v1 from './parsers/llm_extract_v1.mjs';
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
  ['press_release:cga_v1', tradingeconomics_v1],              // fiscal_deficit_pct + govt_capex_runrate
  ['json_api:rbi_fortnightly_v1', tradingeconomics_v1],       // credit_deposit_growth
  ['json_api:rbi_mmo_v1', tradingeconomics_v1],               // banking_liquidity (M3 proxy)
  ['press_release:jpc_steel_v1', tradingeconomics_v1],        // steel_consumption
  ['html_scrape:crisil_v1', tradingeconomics_v1],             // high_yield_credit_spread
  // baltic_dirty_v1 (vlcc_tanker_rates) intentionally not registered until Hormuz tool integration
  // Drewry weekly press release for World Container Index
  ['html_scrape:drewry_v1', drewry_v1],
  // Pure-derived metrics (read peer metric values, no network)
  ['manual:derived_v1', derived_v1],
  // gsec_curve via TE multi-tenor page (10Y as canonical value)
  ['json_api:ccil_v1', tradingeconomics_v1],
  // India govt + NSE/NSDL + PPAC + PIB-mediated sources
  // These often fail from foreign networks but reach from CI / India IPs.
  ['press_release:naukri_v1', india_govt_v1],
  ['csv_download:nsdl_fpi_v1', india_govt_v1],
  ['html_scrape:nsdl_sectoral_v1', nsdl_sectoral_v1],
  ['csv_download:nse_fno_v1', india_govt_v1],
  ['csv_download:nse_blocks_v1', india_govt_v1],
  ['press_release:ppac_v1', india_govt_v1],          // india_crude_basket + pol_demand
  ['press_release:gstn_eway_v1', india_govt_v1],
  ['press_release:npci_upi_v1', india_govt_v1],
  ['press_release:ihmcl_v1', india_govt_v1],
  ['press_release:railways_v1', india_govt_v1],
  ['press_release:moports_v1', india_govt_v1],
  ['press_release:dgca_v1', india_govt_v1],
  ['html_scrape:bse_cement_v1', india_govt_v1],
  ['html_scrape:port_authority_v1', india_govt_v1],
  ['html_scrape:rbi_wacr_v1', india_govt_v1],  // routes wacr_repo_spread to india_govt config
  // RSS-based format-stable parsers (Step 5)
  ['rss:pib_rss_v1', pib_rss_v1],
  // Google News RSS — searches Indian publishers for monthly-release headlines
  ['rss:google_news_rss_v1', google_news_rss_v1],
  // Google News + LLM article-body extraction — for metrics whose value isn't in headlines
  ['llm:google_news_llm_v1', google_news_llm_v1],
  // PIB search + LLM — authoritative source for Indian govt monthly releases (needs India IP)
  ['llm:pib_search_v1', pib_search_v1],
  // Yahoo Finance — free JSON endpoints for NSE-blocked F&O/index metrics
  ['json_api:yahoo_finance_v1', yahoo_finance_v1],
  // PPAC monthly PDF parser for pol_demand
  ['pdf:ppac_v1', ppac_v1],
  // DBnomics free aggregator API (Step 6) — structured JSON, no key
  ['json_api:dbnomics_v1', dbnomics_v1],
  // data.gov.in (Step 7) — CSV mode no key, API mode with optional DATAGOVIN_API_KEY
  ['json_api:datagovin_v1', datagovin_v1],
  ['csv_download:datagovin_v1', datagovin_v1],
  // NSE + RBI direct CSV downloads (Step 8) — most reliable Indian data source
  ['csv_download:nse_rbi_direct_v1', nse_rbi_direct_v1],
  // PDF parser with optional OCR (Step 9)
  ['pdf:pdf_v1', pdf_v1],
  // Playwright SPA renderer (Step 10) — for JS-rendered pages
  ['html_render:playwright_render_v1', playwright_render_v1],
  // Free LLM extraction fallback (Step 11) — universal last-resort
  ['llm:llm_extract_v1', llm_extract_v1],
  // Tier-A alternative scrapers (added 2026-05-12)
  ['html_render:moneycontrol_v1', moneycontrol_v1],
  ['html_render:bse_v1', bse_v1],
  ['rss:nitter_v1', nitter_v1],
  ['pdf:eaindustry_ieci_v1', eaindustry_ieci_v1],
  // Generic Playwright + LLM for any aggregator/broker site (added 2026-05-12)
  ['html_render:web_llm_v1', web_llm_v1],
  // Publisher-direct topic RSS + LLM for industry trade pubs (added 2026-05-12)
  ['rss:publisher_rss_v1', publisher_rss_v1],
  // Tiered orchestrator -- tries multiple sub-parsers in priority order
  ['tiered:tiered_v1', tiered_v1],
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
