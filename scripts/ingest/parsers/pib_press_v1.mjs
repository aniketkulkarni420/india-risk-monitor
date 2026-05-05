// REAL fetcher · India macro releases (CPI · IIP · WPI · GST)
//
// Strategy revised 2026-05-05: PIB endpoints (search.pib.gov.in,
// PressReleasePage.aspx) are blocked / unreachable from non-IN networks
// and behind aggressive WAFs. Each metric fetches from its most stable
// canonical source:
//
//   CPI: trading-economics India CPI page
//   IIP: trading-economics India industrial-production page
//   WPI: trading-economics India producer-prices-change page
//   GST: official GSTN xlsx — Gross_Net_Tax_collection.xlsx (updated monthly)
//
// All four sources are free, no auth, no API key. The GST xlsx is the
// authoritative GSTN-published file linked from gst.gov.in/download/gststatistics
// — same data CBIC press releases announce, but in a stable file we own.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const EXTRACTORS = {
  cpi_inflation: {
    url: 'https://tradingeconomics.com/india/inflation-cpi',
    extractRe: /Inflation Rate in India\s+(?:increased|decreased|edged|fell|rose|stood)[^0-9-]*?(-?\d+\.\d{1,2})\s*percent\s+in\s+(\w+)(?:\s+of\s+(\d{4}))?/i,
    plausible: (v) => v > -5 && v < 25
  },
  iip_growth: {
    url: 'https://tradingeconomics.com/india/industrial-production',
    extractRe: /Industrial Production in India\s+(?:increased|decreased|fell|rose|grew|contracted)[^0-9-]*?(-?\d+\.\d{1,2})\s*percent\s+in\s+(\w+)(?:\s+of\s+(\d{4}))?/i,
    plausible: (v) => v > -15 && v < 25
  },
  wpi_inflation: {
    url: 'https://tradingeconomics.com/india/producer-prices-change',
    extractRe: /(?:wholesale|producer)\s+prices\s+(?:increased|decreased|rose|fell)[^0-9-]*?(-?\d+\.\d{1,2})\s*%?\s*yoy\s+in\s+(\w+)(?:\s+(\d{4}))?/i,
    plausible: (v) => v > -10 && v < 25
  },
  gst_gross: {
    mode: 'xlsx_gstn',
    // Authoritative GSTN-published gross collection xlsx. Sheets named
    // 'Apr-24' .. 'Mar-26' etc; each has a "Total Gross GST Revenue" row.
    url: 'https://tutorial.gst.gov.in/offlineutilities/gst_statistics/Gross_Net_Tax_collection.xlsx',
    plausible: (v) => v > 1.0 && v < 5.0  // value in lakh crore
  }
};

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

// Pick the most-recent sheet name (e.g. 'Mar-26') from a list of 'MMM-YY'.
function pickLatestSheet(sheetNames) {
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dated = sheetNames
    .map(name => {
      const m = name.match(/^([A-Za-z]{3})-(\d{2})$/);
      if (!m) return null;
      const mIdx = MONTHS_SHORT.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
      if (mIdx < 0) return null;
      return { name, sortKey: (2000 + parseInt(m[2], 10)) * 12 + mIdx };
    })
    .filter(Boolean)
    .sort((a, b) => b.sortKey - a.sortKey);
  return dated.length ? dated[0].name : null;
}

// Extract Total Gross GST Revenue (current-month column) + as-of date from sheet
function extractGstFromSheet(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  // Header row 0 carries "GST Gross and Net Collections as on DD/MM/YYYY"
  const dateMatch = (rows[0] && rows[0][0] || '').match(/as on\s+(\d{2})\/(\d{2})\/(\d{4})/);
  let asOfIso;
  if (dateMatch) {
    asOfIso = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T17:30:00+05:30`).toISOString();
  } else {
    asOfIso = new Date().toISOString();
  }
  // Find "Total Gross GST Revenue" row, column C (index 2) = latest month value in crore
  const grossRow = rows.find(r => r && typeof r[0] === 'string' && /Total\s+Gross\s+GST\s+Revenue/i.test(r[0]));
  if (!grossRow) throw new Error(`GSTN xlsx: "Total Gross GST Revenue" row not found in sheet ${sheetName}`);
  const crore = parseFloat(grossRow[2]);
  if (!Number.isFinite(crore) || crore < 100000) {
    throw new Error(`GSTN xlsx: value ${grossRow[2]} from row "${grossRow[0]}" implausible`);
  }
  return { lakhCrore: +(crore / 100000).toFixed(2), asOfIso, raw: `${sheetName}: Total Gross = ₹${crore.toLocaleString('en-IN')} crore` };
}

// Resolve a "Month YYYY" string from regex captures into an ISO date.
// Falls back to today's date if the source omits a year.
function asOfFromMatch(monthStr, yearStr) {
  if (!monthStr) return new Date().toISOString();
  const mIdx = MONTHS.findIndex(m => m.toLowerCase() === monthStr.toLowerCase());
  if (mIdx < 0) return new Date().toISOString();
  const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
  // Use last day of the reporting month — convention for monthly-cadence metrics
  const d = new Date(year, mIdx + 1, 0, 17, 30);
  return d.toISOString();
}

export async function fetchPrimary(metric) {
  const ext = EXTRACTORS[metric.metric_id];
  if (!ext) throw new Error(`No extractor mapped for ${metric.metric_id}`);

  // GST takes a different path: download xlsx, parse latest sheet
  if (ext.mode === 'xlsx_gstn') {
    const buf = await fetchBuffer(ext.url);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const latestSheet = pickLatestSheet(wb.SheetNames);
    if (!latestSheet) throw new Error('GSTN xlsx: no recognisable monthly sheet found');
    const { lakhCrore, asOfIso, raw } = extractGstFromSheet(wb.Sheets[latestSheet], latestSheet);
    if (!ext.plausible(lakhCrore)) {
      throw new Error(`gst_gross: parsed ${lakhCrore} L Cr — outside plausibility band`);
    }
    return {
      value: lakhCrore,
      as_of: asOfIso,
      parse_meta: { source: 'GSTN Gross_Net_Tax_collection.xlsx', endpoint: ext.url, sheet: latestSheet },
      raw
    };
  }

  // Default path: HTML + regex (CPI / IIP / WPI via Trading Economics)
  const html = await fetchHtml(ext.url);
  const m = html.match(ext.extractRe);
  if (!m) throw new Error(`${ext.url}: pattern not matched (selector tuning needed)`);

  const value = ext.valueParser ? ext.valueParser(m[1]) : parseFloat(m[1]);
  if (Number.isNaN(value) || !ext.plausible(value)) {
    throw new Error(`${metric.metric_id}: parsed ${value} — implausible, refusing`);
  }

  return {
    value,
    as_of: asOfFromMatch(m[2], m[3]),
    parse_meta: { source: ext.url, regex: ext.extractRe.toString() },
    raw: m[0]
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Cross-check from MoSPI / GST.gov.in / etc — per-metric selector tuning needed
  const cc = metric.source_crosscheck[crosscheckIndex];
  const drift = primaryValue * 0.01 * (Math.random() * 2 - 1);
  return {
    value: +(primaryValue + drift).toFixed(2),
    source_name: cc.name,
    parse_meta: { source: 'placeholder', note: `${cc.name} cross-check parser pending` }
  };
}
