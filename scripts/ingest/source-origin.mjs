// Source-origin classification for independence tracking.
//
// When a tiered chain has all entries from the SAME origin class, cross-
// verification is weak (sources downstream of same upstream). Tier
// orchestrator can warn (or escalate) when this is the case.

// Each parser_id is classified into one of these origin classes:
//   - govt_direct        : govt website/PDF/RSS/API
//   - exchange_regulator : NSE/BSE/SEBI/NSDL/CDSL
//   - industry_body      : FADA/CMA/IPA/etc
//   - corporate_filing   : Adani/IRB/CONCOR investor pages, BSE filings
//   - news_aggregator    : Business Standard/ET/Mint/Reuters/Bloomberg
//   - foreign_aggregator : DBnomics/IMF/World Bank/FRED/OECD/TradingEconomics
//   - community          : Wikipedia/Reddit
//   - llm_open_web       : Google News + LLM (long-tail)

const CLASS_BY_PARSER = {
  // Govt direct
  'press_release:rbi_policy_v1':       'govt_direct',
  'press_release:rbi_bop_v1':          'govt_direct',
  'press_release:mospi_cpi_v1':        'govt_direct',
  'press_release:mospi_iip_v1':        'govt_direct',
  'press_release:eaindustry_wpi_v1':   'govt_direct',
  'press_release:dgcis_v1':            'govt_direct',
  'press_release:cga_v1':              'govt_direct',
  'press_release:gst_monthly_v1':      'govt_direct',
  'press_release:npci_upi_v1':         'govt_direct',
  'press_release:gstn_eway_v1':        'govt_direct',
  'press_release:ihmcl_v1':            'govt_direct',
  'press_release:railways_v1':         'govt_direct',
  'press_release:moports_v1':          'govt_direct',
  'press_release:dgca_v1':             'govt_direct',
  'press_release:ppac_v1':             'govt_direct',
  'press_release:mot_fta_v1':          'govt_direct',
  'press_release:rbi_fortnightly_v1':  'govt_direct',
  'press_release:rbi_mmo_v1':          'govt_direct',
  'json_api:rbi_refrate_v1':           'govt_direct',
  'json_api:ccil_v1':                  'govt_direct',
  'json_api:gridindia_v1':             'govt_direct',
  'json_api:public_oil_v1':            'govt_direct',
  'json_api:public_gold_v1':           'govt_direct',
  'json_api:public_dxy_v1':            'govt_direct',
  'json_api:cwc_v1':                   'govt_direct',
  'json_api:rbi_wss_v1':               'govt_direct',
  'json_api:rbi_fortnightly_v1':       'govt_direct',
  'pdf:ppac_v1':                       'govt_direct',
  'pdf:eaindustry_ieci_v1':            'govt_direct',
  'html_scrape:rbi_mmo_daily_v1':      'govt_direct',
  'pdf:pdf_v1':                        'govt_direct',
  'rss:pib_rss_v1':                    'govt_direct',
  'llm:pib_search_v1':                 'govt_direct',

  // Exchange/regulator
  'csv_download:nse_fii_dii_v1':       'exchange_regulator',
  'csv_download:nse_indices_v1':       'exchange_regulator',
  'csv_download:nse_vix_v1':           'exchange_regulator',
  'csv_download:nse_pe_v1':            'exchange_regulator',
  'csv_download:nse_fno_v1':           'exchange_regulator',
  'csv_download:nse_blocks_v1':        'exchange_regulator',
  'csv_download:nsdl_fpi_v1':          'exchange_regulator',
  'csv_download:nse_rbi_direct_v1':    'exchange_regulator',
  'html_scrape:bse_cement_v1':         'exchange_regulator',
  'html_scrape:port_authority_v1':     'exchange_regulator',
  'html_scrape:rbi_wacr_v1':           'exchange_regulator',
  'html_scrape:nsdl_sectoral_v1':      'exchange_regulator',
  'html_render:bse_v1':                'exchange_regulator',
  'html_render:playwright_render_v1':  'exchange_regulator',

  // Industry body
  'press_release:fada_monthly_v1':     'industry_body',
  'press_release:sp_pmi_india_v1':     'industry_body',
  'press_release:jpc_steel_v1':        'industry_body',
  'press_release:naukri_v1':           'industry_body',
  'html_scrape:drewry_v1':             'industry_body',
  'html_scrape:hormuz_v1':             'industry_body',
  'html_scrape:crisil_v1':             'industry_body',
  'press_release:baltic_dirty_v1':     'industry_body',

  // Corporate filing / news aggregator
  'html_render:moneycontrol_v1':       'news_aggregator',
  'html_render:web_llm_v1':            'mixed',  // varies by URL
  'rss:publisher_rss_v1':              'news_aggregator',
  'rss:google_news_rss_v1':            'news_aggregator',
  'llm:google_news_llm_v1':            'news_aggregator',

  // Foreign aggregator
  'json_api:dbnomics_v1':              'foreign_aggregator',
  'json_api:datagovin_v1':             'govt_direct',  // Indian govt portal
  'csv_download:datagovin_v1':         'govt_direct',
  'html_scrape:tradingeconomics_v1':   'foreign_aggregator',
  'html_scrape:te_inr_v1':             'foreign_aggregator',
  'json_api:yahoo_finance_v1':         'foreign_aggregator',

  // LLM open-web
  'llm:llm_extract_v1':                'llm_open_web',

  // Derived
  'manual:derived_v1':                 'derived',
};

export function classOfParser(parser_id) {
  return CLASS_BY_PARSER[parser_id] || 'unknown';
}

/**
 * Given a tier_chain (array of parser_ids), compute origin-class diversity.
 * Returns { distinct, classes, allSameClass: bool } - useful for warnings.
 */
export function chainDiversity(tier_chain) {
  if (!Array.isArray(tier_chain)) return { distinct: 0, classes: [], allSameClass: false };
  const classes = tier_chain.map(classOfParser);
  const distinct = new Set(classes).size;
  return {
    distinct,
    classes,
    allSameClass: distinct === 1 && tier_chain.length > 1
  };
}
