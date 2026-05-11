// REAL fetcher · NSE + RBI direct CSV downloads
//
// Both NSE (archives.nseindia.com) and RBI (rbi.org.in/Scripts/...) publish
// raw CSV files at predictable URLs. No scraping, no auth, no API key —
// just file downloads. Most reliable Indian-data source available.
//
// NSE archive pattern:
//   https://archives.nseindia.com/products/content/sec_bhavdata_full_{DDMMYYYY}.csv
//   https://archives.nseindia.com/content/indices/ind_close_all_{DDMMYYYY}.csv
//   https://archives.nseindia.com/archives/fo/mkt/fo_mktlots_{date}.csv
//
// RBI DBIE pattern:
//   https://rbidocs.rbi.org.in/rdocs/Wss/PDFs/{filename}.csv
//   https://rbidocs.rbi.org.in/rdocs/PublicationReport/Pdfs/0WSS{date}.pdf  (PDFs go through PDF parser instead)

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';
import { parseCsv, pickLatestRow } from './datagovin_v1.mjs';

// Per-metric:
//   urlFn(today): function returning URL (often date-dependent)
//   columns: { date, value }
//   plausible
//   valueTransform?
//   walkBackDays: fall back to previous business day if today's file 404s
const CONFIGS = {
  // Nifty 50 close (from NSE indices archive)
  nifty_close: {
    urlFn: (d) => `https://archives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(d)}.csv`,
    columns: { date: 'index date', value: 'closing index value' },
    matchRow: (r) => (r['index name'] || '').toLowerCase().includes('nifty 50'),
    plausible: (v) => v > 10000 && v < 50000,
    walkBackDays: 7
  },

  // Bank Nifty close
  bank_nifty_close: {
    urlFn: (d) => `https://archives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(d)}.csv`,
    columns: { date: 'index date', value: 'closing index value' },
    matchRow: (r) => (r['index name'] || '').toLowerCase() === 'nifty bank',
    plausible: (v) => v > 20000 && v < 100000,
    walkBackDays: 7
  },

  // Nifty Auto sectoral index
  nifty_auto_close: {
    urlFn: (d) => `https://archives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(d)}.csv`,
    columns: { date: 'index date', value: 'closing index value' },
    matchRow: (r) => (r['index name'] || '').toLowerCase() === 'nifty auto',
    plausible: (v) => v > 5000 && v < 50000,
    walkBackDays: 7
  }
};

function ddmmyyyy(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No nse_rbi_direct config for ${metric.metric_id}`);

  const errors = [];
  const today = new Date();
  const walkBack = cfg.walkBackDays || 1;

  for (let dayOffset = 0; dayOffset < walkBack; dayOffset++) {
    const d = new Date(today.getTime() - dayOffset * 24 * 3600 * 1000);
    if (isWeekend(d)) continue;  // NSE doesn't trade weekends
    const url = cfg.urlFn(d);
    try {
      const res = await fetchResilient(url, {
        timeoutMs: 20000, retries: 1, wayback: false, browserUa: true
      });
      const rows = parseCsv(res.body);
      if (!rows.length) { errors.push(`${url}: empty CSV`); continue; }

      // Optional row-filter (e.g. "find Nifty 50 in multi-index file")
      const candidates = cfg.matchRow ? rows.filter(cfg.matchRow) : rows;
      if (!candidates.length) { errors.push(`${url}: no matching row`); continue; }

      const latest = pickLatestRow(candidates, cfg.columns.date.toLowerCase());
      const rawVal = latest[cfg.columns.value.toLowerCase()] || '';
      const value = parseFloat(String(rawVal).replace(/,/g, ''));
      if (Number.isNaN(value) || !cfg.plausible(value)) {
        errors.push(`${url}: ${value} outside plausible band`);
        continue;
      }
      try { recordSnapshot(metric.metric_id, url, res.body, value, 'nse_rbi_direct_v1'); } catch {}
      return {
        value: cfg.valueTransform ? cfg.valueTransform(value) : value,
        as_of: parseAsOf(latest[cfg.columns.date.toLowerCase()]) || d.toISOString(),
        parse_meta: { source: 'nse-direct-csv', url, day_offset: dayOffset },
        raw: JSON.stringify(latest).slice(0, 200)
      };
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(`${metric.metric_id}: NSE/RBI direct download failed [${errors.slice(0, 3).join(' | ')}]`);
}

function parseAsOf(raw) {
  if (!raw) return null;
  // NSE date format is "DD-MMM-YYYY" e.g. "11-MAY-2026"
  const m = String(raw).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mo = months[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(Date.UTC(+m[3], mo, +m[1])).toISOString();
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'nse-rbi-crosscheck-pending', parse_meta: { source: 'pending' } };
}

export { ddmmyyyy, isWeekend, parseAsOf };
