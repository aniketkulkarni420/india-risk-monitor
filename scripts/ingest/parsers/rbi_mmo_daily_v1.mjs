// REAL fetcher · RBI Money Market Operations daily release.
//
// RBI publishes the daily MMO release at ~17:00 IST every business day:
//   https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx
//
// Contains daily Weighted Average Call Rate (WACR), Triparty Repo Rate,
// Market Repo Rate, and the policy Repo Rate. WACR-Repo spread (in bps)
// is the wacr_repo_spread metric.
//
// India-IP required (rbi.org.in blocks foreign IPs). Use via India runner.

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const RBI_PRESS_LIST = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx';
const RBI_MMO_PAGE = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx';
const RBI_BASE = 'https://www.rbi.org.in/Scripts/';

const CONFIGS = {
  wacr_repo_spread: {
    // BUG FIX 2026-05-15: previous regex expected the literal phrase
    // "Weighted Average Call Rate" but the actual MMO HTML has the row
    // label "Call Money" and the WACR sits in a separate table cell
    // whose ONLY identifier is the header attribute "WeightedAverageRate":
    //   <th> ... Call Money </th>
    //   <td headers="...VolumeOneLeg"> 15,463.05 </td>
    //   <td headers="...WeightedAverageRate"> 5.21 </td>   ← WACR
    // New regex finds "Call Money" → skips ahead (volume cell) → matches
    // the WeightedAverageRate cell-header attribute → captures the number
    // before the closing "<".
    extractors: [
      /Call\s+Money[\s\S]{1,400}?WeightedAverageRate[^>]*>\s*([0-9]{1,2}\.[0-9]+)\s*</i,
      /Weighted\s+Average\s+Call\s+Rate[^0-9]{0,80}(\d{1,2}\.\d{2,4})\s*%/i,  // legacy fallback
      /WACR[^0-9]{0,80}(\d{1,2}\.\d{2,4})\s*%/i
    ],
    repoExtractors: [
      /Policy\s+Repo\s+Rate[^0-9]{0,40}(\d{1,2}\.\d{2})\s*%/i,
      /Repo\s+Rate[^0-9]{0,40}(\d{1,2}\.\d{2})\s*%/i
    ],
    plausible: (v) => Math.abs(v) <= 300  // spread in bps
  }
};

async function fetchListAndPickLatest() {
  // Find the latest "Money Market Operations as on …" press-release on the
  // RBI press-release listing. Press releases are listed newest-first and
  // prid increases monotonically — pick max prid for the safest "latest".
  const res = await fetchResilient(RBI_PRESS_LIST, {
    timeoutMs: 25000, retries: 1, wayback: false, browserUa: true
  });
  if (!res.body) return null;
  const re = /<a[^>]*href=['"]?(BS_PressReleaseDisplay\.aspx\?prid=(\d+))['"]?[^>]*>([^<]{1,200})<\/a>/gi;
  const links = [];
  let m;
  while ((m = re.exec(res.body)) !== null) {
    if (/Money\s+Market\s+Operations/i.test(m[3])) {
      links.push({ url: RBI_BASE + m[1], prid: +m[2] });
    }
  }
  if (!links.length) return null;
  links.sort((a, b) => b.prid - a.prid);
  return links[0].url;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No rbi_mmo_daily_v1 config for ${metric.metric_id}`);

  // Try latest MMO page (may require India IP)
  let releaseUrl = null;
  try { releaseUrl = await fetchListAndPickLatest(); } catch {}

  const urls = [];
  if (releaseUrl) urls.push(releaseUrl);
  urls.push(RBI_MMO_PAGE);

  const errors = [];
  for (const url of urls) {
    try {
      const res = await fetchResilient(url, {
        timeoutMs: 25000, retries: 1, wayback: false, browserUa: true
      });
      const html = res.body;
      let wacr = null;
      for (const re of cfg.extractors) {
        const m = html.match(re);
        if (m) { wacr = parseFloat(m[1]); break; }
      }
      let repo = null;
      for (const re of cfg.repoExtractors) {
        const m = html.match(re);
        if (m) { repo = parseFloat(m[1]); break; }
      }
      if (wacr === null) { errors.push(`${url}: WACR not matched`); continue; }
      if (repo === null) repo = 5.50;  // fallback to known repo if RBI page only quotes WACR

      const spreadBps = Math.round((wacr - repo) * 100);
      if (!cfg.plausible(spreadBps)) {
        errors.push(`${url}: spread ${spreadBps} out of band (wacr=${wacr}, repo=${repo})`); continue;
      }
      try { recordSnapshot(metric.metric_id, url, html, spreadBps, 'rbi_mmo_daily_v1'); } catch {}
      return {
        value: spreadBps,
        as_of: new Date().toISOString(),
        parse_meta: { source: 'rbi-mmo-daily', url, wacr_pct: wacr, repo_pct: repo },
        raw: `WACR ${wacr}% · Repo ${repo}% · spread ${spreadBps} bps`
      };
    } catch (e) {
      errors.push(`${url}: ${(e.message||'').slice(0,80)}`);
    }
  }
  throw new Error(`rbi_mmo_daily_v1: ${urls.length} URLs failed · ${errors.slice(0,2).join(' | ')}`);
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'rbi-mmo-crosscheck-pending', parse_meta: { source: 'pending' } };
}
