#!/usr/bin/env node
// One-shot script: add tier_chain to single-source metrics so every metric
// has at least 2 fallback paths.
// Run once: `node scripts/add-tier-chains.mjs`

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const METRICS_DIR = join(ROOT, 'data', 'metrics');

// Per-metric tier chains. Primary stays first; backup tiers added.
// Origin-class diversity is encoded by mixing parser types.
const CHAINS = {
  // === Daily NSE flows (currently single source · NSE may block again) ===
  fii_equity_daily:    ['csv_download:nse_fii_dii_v1', 'html_render:moneycontrol_v1', 'llm:google_news_llm_v1'],
  fii_equity_mtd:      ['csv_download:nse_fii_dii_v1', 'html_render:moneycontrol_v1', 'llm:google_news_llm_v1'],
  fii_equity_cytd:     ['csv_download:nse_fii_dii_v1', 'html_render:moneycontrol_v1'],
  dii_daily:           ['csv_download:nse_fii_dii_v1', 'html_render:moneycontrol_v1', 'llm:google_news_llm_v1'],
  dii_mtd:             ['csv_download:nse_fii_dii_v1', 'html_render:moneycontrol_v1'],

  // === Daily market indices (NSE-direct, add aggregator fallback) ===
  nifty_50:            ['csv_download:nse_indices_v1', 'html_scrape:tradingeconomics_v1'],
  bank_nifty:          ['csv_download:nse_indices_v1', 'html_scrape:tradingeconomics_v1'],
  india_vix:           ['csv_download:nse_vix_v1', 'html_scrape:tradingeconomics_v1'],
  nifty_pe_5y:         ['csv_download:nse_pe_v1', 'html_scrape:tradingeconomics_v1'],

  // === Daily macro (RBI direct, add DBnomics as govt-independent fallback) ===
  banking_liquidity:   ['json_api:rbi_mmo_v1', 'json_api:dbnomics_v1', 'html_scrape:tradingeconomics_v1'],
  gsec_curve:          ['json_api:ccil_v1', 'json_api:dbnomics_v1', 'html_scrape:tradingeconomics_v1'],
  repo_rate:           ['press_release:rbi_policy_v1', 'json_api:dbnomics_v1', 'html_scrape:tradingeconomics_v1'],

  // === Daily commodities (TE direct, add DBnomics + news fallback) ===
  gold_usd:            ['json_api:public_gold_v1', 'json_api:dbnomics_v1', 'llm:google_news_llm_v1'],
  dxy:                 ['json_api:public_dxy_v1', 'json_api:dbnomics_v1'],
  brent_crude:         ['json_api:public_oil_v1', 'json_api:dbnomics_v1', 'html_scrape:tradingeconomics_v1'],
  india_crude_basket:  ['press_release:ppac_v1', 'html_scrape:tradingeconomics_v1'],
  baltic_dry_index:    ['html_scrape:tradingeconomics_v1', 'json_api:dbnomics_v1'],
  hormuz_throughput:   ['html_scrape:hormuz_v1', 'llm:google_news_llm_v1'],
  vlcc_tanker_rates:   ['press_release:baltic_dirty_v1', 'html_scrape:tradingeconomics_v1', 'llm:google_news_llm_v1'],

  // === Weekly metrics ===
  reservoir_levels:    ['json_api:cwc_v1', 'llm:google_news_llm_v1'],
  drewry_wci:          ['html_scrape:drewry_v1', 'llm:google_news_llm_v1'],
  fx_reserves:         ['json_api:rbi_wss_v1', 'json_api:dbnomics_v1'],
  high_yield_credit_spread: ['html_scrape:crisil_v1', 'llm:google_news_llm_v1'],

  // === Monthly macro · government releases ===
  cpi_inflation:       ['press_release:mospi_cpi_v1', 'json_api:dbnomics_v1', 'llm:google_news_llm_v1'],
  wpi_inflation:       ['press_release:eaindustry_wpi_v1', 'pdf:eaindustry_ieci_v1', 'json_api:dbnomics_v1'],
  iip_growth:          ['press_release:mospi_iip_v1', 'pdf:eaindustry_ieci_v1', 'json_api:dbnomics_v1'],
  pmi_combined:        ['press_release:sp_pmi_india_v1', 'html_scrape:tradingeconomics_v1', 'llm:google_news_llm_v1'],
  trade_deficit:       ['press_release:dgcis_v1', 'html_scrape:tradingeconomics_v1', 'llm:google_news_llm_v1'],
  fiscal_deficit_pct:  ['press_release:cga_v1', 'html_scrape:tradingeconomics_v1', 'llm:google_news_llm_v1'],
  govt_capex_runrate:  ['press_release:cga_v1', 'llm:google_news_llm_v1'],
  cad_pct_gdp:         ['press_release:rbi_bop_v1', 'json_api:dbnomics_v1', 'html_scrape:tradingeconomics_v1'],

  // === Monthly industry ===
  steel_consumption:   ['press_release:jpc_steel_v1', 'pdf:eaindustry_ieci_v1', 'llm:google_news_llm_v1'],
  naukri_jobspeak:     ['press_release:naukri_v1', 'llm:google_news_llm_v1'],
  foreign_tourist_arrivals: ['press_release:mot_fta_v1', 'llm:google_news_llm_v1'],
  air_pax:             ['press_release:dgca_v1', 'llm:google_news_llm_v1'],
  auto_2w:             ['press_release:fada_monthly_v1', 'llm:google_news_llm_v1'],
  auto_3w:             ['press_release:fada_monthly_v1', 'llm:google_news_llm_v1'],
  auto_cv:             ['press_release:fada_monthly_v1', 'llm:google_news_llm_v1'],
  auto_pv:             ['press_release:fada_monthly_v1', 'llm:google_news_llm_v1'],
  auto_tractor:        ['press_release:fada_monthly_v1', 'llm:google_news_llm_v1'],

  // === Monthly economy already tier-chained — keep as-is ===
  // cement_dispatches, eway_bills, fastag_toll, gst_gross, pol_demand,
  // port_cargo, rail_freight, upi_value, power_demand
};

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (n.endsWith('.json')) out.push(p);
  }
  return out;
}

let updated = 0;
let skipped = 0;
for (const f of walk(METRICS_DIR)) {
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const id = j.metric_id;
    const chain = CHAINS[id];
    if (!chain) { skipped++; continue; }
    // If already tiered, leave alone (intentional manual override)
    if (j.source_primary?.parser === 'tiered:tiered_v1' && Array.isArray(j.source_primary.tier_chain) && j.source_primary.tier_chain.length >= chain.length) {
      skipped++; continue;
    }
    j.source_primary.parser = 'tiered:tiered_v1';
    j.source_primary.tier_chain = chain;
    writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`  ${id} → tiered (${chain.length} tiers)`);
    updated++;
  } catch (e) {
    console.log(`  SKIP ${f}: ${e.message}`);
  }
}
console.log(`\nUpdated ${updated} · skipped ${skipped}`);
