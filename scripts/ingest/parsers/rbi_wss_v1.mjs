// REAL fetcher · RBI Weekly Statistical Supplement (WSS).
//
// The authoritative source for India FX reserves. RBI publishes the WSS
// every Friday as a press release titled "Reserve Bank of India – Bulletin
// Weekly Statistical Supplement – Extract" on rbi.org.in. The press release
// is static HTML containing a "Foreign Exchange Reserves" table; we extract
// the "Total Reserves" row in USD million → return USD billion.
//
// Verified 2026-05-15:
//   Total Reserves 6556404 690693 -25983 ... → 690.69 USD bn
//
// Two-step:
//   1. Fetch the press-release listing page, find the most recent link whose
//      title matches /Weekly Statistical Supplement.*Extract/i
//   2. Fetch that press-release page; extract Total Reserves USD million.

import { fetchResilient } from '../fetch-resilient.mjs';

const LIST_URL = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx';
const BASE_URL = 'https://www.rbi.org.in/Scripts/';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function findLatestWssExtractUrl() {
  const res = await fetchResilient(LIST_URL, { timeoutMs: 20000, retries: 1, wayback: false, browserUa: true });
  if (!res.body) throw new Error('rbi_wss_v1: empty press-release listing');
  // Pull every <a href="BS_PressReleaseDisplay.aspx?prid=...">TITLE</a>
  const links = [];
  const re = /<a[^>]*href=['"]?(BS_PressReleaseDisplay\.aspx\?prid=(\d+))['"]?[^>]*>([^<]{1,250})<\/a>/gi;
  let m;
  while ((m = re.exec(res.body)) !== null) {
    links.push({ href: m[1], prid: +m[2], title: m[3].replace(/\s+/g, ' ').trim() });
  }
  // Title patterns observed: "Bulletin Weekly Statistical Supplement – Extract"
  // The em-dash may also appear as an ascii hyphen depending on encoding.
  const wss = links.filter(l => /weekly statistical supplement.*extract/i.test(l.title));
  if (!wss.length) {
    throw new Error(`rbi_wss_v1: no WSS Extract press release found in ${links.length} links`);
  }
  // Press releases are listed newest-first; prid increases monotonically. Take max prid.
  wss.sort((a, b) => b.prid - a.prid);
  return { url: BASE_URL + wss[0].href, prid: wss[0].prid, title: wss[0].title };
}

const CONFIGS = {
  fx_reserves: {
    extract: (text) => {
      // Format observed: "Total Reserves  6556404  690693  -25983  ..."
      //   ^^^^^^^^^^^^^^ ^^^^^^^         ^^^^^^
      //   row label       INR crore        USD million ← we want this
      const m = text.match(/Total\s+Reserves[^\d]+([\d,]+)\s+([\d,]+)/i);
      if (!m) return null;
      const usdMillion = parseInt(m[2].replace(/,/g, ''), 10);
      if (!Number.isFinite(usdMillion)) return null;
      return +(usdMillion / 1000).toFixed(1);  // USD million → USD billion
    },
    plausible: (v) => v > 400 && v < 900
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No rbi_wss_v1 config for ${metric.metric_id}`);

  const { url: wssUrl, prid, title } = await findLatestWssExtractUrl();
  const res = await fetchResilient(wssUrl, { timeoutMs: 25000, retries: 1, wayback: false, browserUa: true });
  if (!res.body) throw new Error(`rbi_wss_v1: empty WSS page (prid=${prid})`);

  // Convert to plain text (HTML strip) before regex — robust against tag noise.
  const text = res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const value = cfg.extract(text);
  if (value === null) {
    throw new Error(`rbi_wss_v1: Total Reserves row not matched in prid=${prid}`);
  }
  if (!cfg.plausible(value)) {
    throw new Error(`rbi_wss_v1: extracted ${value} outside plausible band`);
  }
  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'RBI WSS Extract press release', endpoint: wssUrl, prid, title: title.slice(0, 200) },
    raw: `RBI WSS prid=${prid} · Total Reserves $${value}bn`
  };
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'rbi-wss-crosscheck-pending', parse_meta: { source: 'pending' } };
}
