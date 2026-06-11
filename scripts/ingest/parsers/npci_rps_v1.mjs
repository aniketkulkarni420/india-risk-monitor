// NPCI Retail Payments Statistics XLSX parser — official NETC FASTag series.
//
// Discovery: https://www.npci.org.in/api/retail-payment-statistics-list returns
// the current upload URLs (filenames change per upload, so never hardcode them).
// The XLSX carries quarterly (volume Mn, value ₹Bn) pairs from FY22-23 onward,
// plus trailing per-month columns (Excel date-serial headers) for the current FY.
//
// Value contract for fastag_toll: latest MONTHLY toll value in ₹ Cr when a month
// column exists (fresher), else the latest complete quarter total in ₹ Cr.
// extras always carry the quarterly QoQ + same-quarter-YoY (user-approved basis).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';
const LIST_API = 'https://www.npci.org.in/api/retail-payment-statistics-list';
const BASE = 'https://www.npci.org.in';

// Excel serial date → JS Date (1899-12-30 epoch, UTC)
function serialToDate(n) {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

function lastDayOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

// "F.Y-2025-26 Q4" / "FY22-23 Q1" → { fyEnd: 2026, q: 4 } (calendar quarter end below)
function parseQuarterLabel(s) {
  const m = String(s).match(/F\.?Y\.?-?\s*(\d{4}|\d{2})-?(\d{2})\s*Q([1-4])/i);
  if (!m) return null;
  let startYear = parseInt(m[1], 10);
  if (startYear < 100) startYear += 2000;
  return { startYear, q: parseInt(m[3], 10) };
}

// Indian FY quarter → quarter-end date. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
function quarterEndDate({ startYear, q }) {
  const endMonth = [5, 8, 11, 2][q - 1]; // 0-based: Jun, Sep, Dec, Mar
  const year = q === 4 ? startYear + 1 : startYear;
  return new Date(Date.UTC(year, endMonth + 1, 0));
}

async function discoverXlsxUrl() {
  const res = await fetch(LIST_API, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NPCI RPS list API HTTP ${res.status}`);
  const j = await res.json();
  const files = j?.data?.files || [];
  const xlsx = files.find(f => /\.xlsx$/i.test(f?.media?.url || ''));
  if (!xlsx) throw new Error('NPCI RPS list API has no .xlsx entry');
  return BASE + xlsx.media.url;
}

// Parse the workbook into { quarters: [{label, end, volMn, valBn}], months: [{date, end, volMn, valBn}] }
// for the row whose system-name cell matches rowRe.
export function extractSeries(workbook, rowRe) {
  const XLSX = require('xlsx');
  const sheetName = workbook.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });

  // Header row: the one containing a "Q1" quarter label in any cell
  const headerIdx = grid.findIndex(row =>
    (row || []).some(c => typeof c === 'string' && parseQuarterLabel(c)));
  if (headerIdx === -1) throw new Error('NPCI RPS: no quarter header row found');
  const header = grid[headerIdx];

  const dataRow = grid.find(row =>
    (row || []).some(c => typeof c === 'string' && rowRe.test(c)));
  if (!dataRow) throw new Error(`NPCI RPS: no row matching ${rowRe}`);

  const quarters = [];
  const months = [];
  for (let col = 0; col < header.length; col++) {
    const h = header[col];
    if (h == null) continue;
    const vol = dataRow[col];
    const val = dataRow[col + 1];
    if (typeof vol !== 'number' || typeof val !== 'number') continue;
    const q = typeof h === 'string' ? parseQuarterLabel(h) : null;
    if (q) {
      quarters.push({ label: String(h).trim(), end: quarterEndDate(q), volMn: vol, valBn: val, q });
    } else if (typeof h === 'number' && h > 40000 && h < 60000) {
      const d = serialToDate(h);
      months.push({ date: d, end: lastDayOfMonth(d), volMn: vol, valBn: val });
    }
    // FY-total columns (label without Qn) are intentionally skipped
  }
  quarters.sort((a, b) => a.end - b.end);
  months.sort((a, b) => a.end - b.end);
  if (quarters.length === 0) throw new Error('NPCI RPS: no quarterly data points parsed');
  return { quarters, months };
}

function pct(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export async function fetchPrimary(metric) {
  if (metric.metric_id !== 'fastag_toll') {
    throw new Error(`npci_rps_v1 not configured for ${metric.metric_id}`);
  }
  const XLSX = require('xlsx');

  let buf;
  if (process.env.IRM_NPCI_RPS_FILE) {
    buf = readFileSync(process.env.IRM_NPCI_RPS_FILE); // offline test hook
  } else {
    const url = await discoverXlsxUrl();
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`NPCI RPS XLSX HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const { quarters, months } = extractSeries(wb, /^\s*NETC\s*$/);

  const lastQ = quarters[quarters.length - 1];
  const prevQ = quarters[quarters.length - 2] || null;
  const yoyQ = quarters.find(x =>
    x.q.q === lastQ.q.q && x.q.startYear === lastQ.q.startYear - 1) || null;

  const latestMonth = months.length ? months[months.length - 1] : null;
  const prevMonth = months.length > 1 ? months[months.length - 2] : null;

  // ₹ Bn → ₹ Cr (1 Bn = 100 Cr)
  const value = latestMonth ? latestMonth.valBn * 100 : lastQ.valBn * 100;
  const asOf = (latestMonth ? latestMonth.end : lastQ.end).toISOString();
  const periodLabel = latestMonth
    ? latestMonth.date.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : lastQ.label;

  if (!(value > 500 && value < 100000)) {
    throw new Error(`NPCI RPS: implausible FASTag value ₹${value} Cr`);
  }

  return {
    value: Math.round(value * 100) / 100,
    as_of: asOf,
    parse_meta: { source: 'NPCI Retail Payments Statistics XLSX', period: periodLabel },
    extra: {
      period_label: periodLabel,
      period_basis: latestMonth ? 'monthly' : 'quarterly',
      latest_quarter: lastQ.label,
      latest_quarter_value_cr: Math.round(lastQ.valBn * 100 * 100) / 100,
      latest_quarter_volume_mn: lastQ.volMn,
      qoq_pct: prevQ ? pct(lastQ.valBn, prevQ.valBn) : null,
      yoy_quarter_pct: yoyQ ? pct(lastQ.valBn, yoyQ.valBn) : null,
      mom_pct: (latestMonth && prevMonth) ? pct(latestMonth.valBn, prevMonth.valBn) : null,
      volume_mn: latestMonth ? latestMonth.volMn : lastQ.volMn
    }
  };
}

// Single official source — no independent free crosscheck for NETC monthly yet.
// Honest pending (verification-honesty rules demote to single_source downstream).
export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/npci-rps',
    parse_meta: { source: 'pending' }
  };
}
