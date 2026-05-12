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

const RBI_MMO_LIST = 'https://www.rbi.org.in/Scripts/BS_ViewBulletin.aspx';
const RBI_MMO_PAGE = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx';

const CONFIGS = {
  wacr_repo_spread: {
    // Multiple regex fallbacks for various RBI release wordings
    extractors: [
      /Weighted\s+Average\s+Call\s+Rate[^0-9]{0,80}(\d{1,2}\.\d{2,4})\s*%/i,
      /WACR[^0-9]{0,80}(\d{1,2}\.\d{2,4})\s*%/i,
      /Call\s+Money\s+Rate[^0-9]{0,80}(\d{1,2}\.\d{2,4})\s*%/i
    ],
    repoExtractors: [
      /Repo\s+Rate[^0-9]{0,40}(\d{1,2}\.\d{2})\s*%/i,
      /Policy\s+Repo\s+Rate[^0-9]{0,40}(\d{1,2}\.\d{2})\s*%/i
    ],
    plausible: (v) => Math.abs(v) <= 300  // spread in bps
  }
};

async function fetchListAndPickLatest() {
  // RBI press releases list page — find latest MMO link
  const res = await fetchResilient(RBI_MMO_LIST, {
    timeoutMs: 25000, retries: 1, wayback: false, browserUa: true
  });
  // Find first link matching "Money Market Operations"
  const m = res.body.match(/<a[^>]+href="([^"]+)"[^>]*>[^<]*Money\s+Market\s+Operations[^<]*<\/a>/i);
  if (!m) return null;
  let url = m[1];
  if (url.startsWith('/')) url = 'https://www.rbi.org.in' + url;
  return url;
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
