#!/usr/bin/env node
// Daily content mirror · resilience layer.
//
// Iterates over every URL referenced in any metric's tier_chain configs and
// fetches it, storing the raw HTML in data/source-cache/{host}/{date}__{key}.html.gz.
//
// When live ingest fails, fetchResilient falls back to this cache (up to 14
// days old). So even if PIB/NHAI/etc are down on a given day, the dashboard
// keeps the last-good content available for re-extract.
//
// Run daily via .github/workflows/mirror-sources.yml.

import { fetchResilient } from './ingest/fetch-resilient.mjs';
import { writeCache } from './ingest/source-cache.mjs';

// Critical URLs to keep mirrored. Hand-curated · roughly maps to all tier_chain
// URLs across metrics. Extending the list is cheap.
const URLS = [
  // Govt PDFs (highest priority — primary sources for many metrics)
  'https://www.ppac.gov.in/consumption/petroleum-products',
  'https://eaindustry.nic.in/pdf_files/cmonthly.pdf',
  'https://eaindustry.nic.in/',

  // PIB ministry pages
  'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=10',
  'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=14',
  'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=44',
  'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=63',
  'https://pib.gov.in/PressReleseDetailm.aspx?Mincode=43',

  // NHAI / NSDL / Indian Railways
  'https://nhai.gov.in/nhai/en/major-achievements',
  'https://www.fpi.nsdl.co.in/web/Reports/Yearwise.aspx',
  'https://www.indianrailways.gov.in/railwayboard/uploads/directorate/stat_econ/Outlook/Index_Statistics.html',

  // Wikipedia (community-maintained tables · monthly updated)
  'https://en.wikipedia.org/wiki/FASTag',
  'https://en.wikipedia.org/wiki/Indian_Railways',
  'https://en.wikipedia.org/wiki/Major_ports_of_India',

  // Aggregators that may go down
  'https://www.adaniports.com/Investors/Investor-Information',
  'https://tradingeconomics.com/india/currency',
  'https://tradingeconomics.com/india/composite-pmi',
  'https://tradingeconomics.com/india/interest-rate',
  'https://tradingeconomics.com/india/balance-of-trade',
  'https://tradingeconomics.com/india/current-account-to-gdp',
  'https://tradingeconomics.com/commodity/gold',
  'https://tradingeconomics.com/commodity/baltic',
  'https://tradingeconomics.com/united-states/currency',

  // News aggregator topic pages
  'https://www.trendlyne.com/markets-today/today-block-deals-india/',

  // Publisher topic RSS feeds
  'https://www.business-standard.com/rss/economy-policy-10302.rss',
  'https://economictimes.indiatimes.com/news/economy/indicators/rssfeeds/1373380680.cms',
  'https://www.livemint.com/rss/economy',
  'https://www.constructionworld.in/rss',
  'https://www.maritimegateway.com/feed/',
  'https://www.logisticsindia.in/feed/'
];

const startMs = Date.now();
let ok = 0, failed = 0;

console.log(`Mirroring ${URLS.length} URLs...`);
console.log();

const settled = await Promise.allSettled(URLS.map(async (url) => {
  try {
    const res = await fetchResilient(url, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true, useCache: false });
    if (res.body && res.body.length > 200) {
      writeCache(url, res.body);
      return { url, ok: true, bytes: res.body.length };
    }
    return { url, ok: false, reason: `empty body (${res.body?.length || 0} bytes)` };
  } catch (e) {
    return { url, ok: false, reason: (e.message || '').slice(0, 80) };
  }
}));

for (const r of settled) {
  if (r.status === 'fulfilled' && r.value.ok) {
    ok++;
    console.log(`  ✓ ${r.value.url.slice(0, 80)} (${r.value.bytes} bytes)`);
  } else {
    failed++;
    const v = r.status === 'fulfilled' ? r.value : { url: '?', reason: String(r.reason) };
    console.log(`  ✗ ${v.url.slice(0, 80)} · ${v.reason}`);
  }
}

const totalMin = ((Date.now() - startMs) / 60000).toFixed(1);
console.log();
console.log(`Mirror done · ${ok} ok / ${failed} failed · ${totalMin} min`);
process.exit(0);
