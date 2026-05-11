// REAL fetcher · data.gov.in (Indian Government Open Data Portal)
//
// Free portal with ~1000 datasets. Two access modes:
//   A) Resource API with API key (free, get at data.gov.in/user/register):
//      https://api.data.gov.in/resource/{resource_id}?api-key=KEY&format=json&offset=0&limit=10
//   B) Direct CSV download (no key, stable URLs):
//      https://data.gov.in/files/ogdpv2dms/...csv
//
// Reads optional env var DATAGOVIN_API_KEY. Falls back to direct CSV when key
// is absent. CSV mode is preferred — no key, no rate limit, format-stable.

import { fetchResilient } from '../fetch-resilient.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const API_KEY = process.env.DATAGOVIN_API_KEY || null;

// Per-metric config:
//   mode: 'csv' | 'api'
//   url: full CSV download URL (mode=csv) or resource_id (mode=api)
//   columns: { date, value }  - column names to extract
//   plausible
//   valueTransform?
const CONFIGS = {
  // Example: All India CPI (general) monthly — MoSPI's data.gov.in mirror
  // Confirm resource_id by browsing the dataset page once.
  cpi_general_dgi: {
    mode: 'api',
    resource_id: '6b3c389e-1c43-426d-aeec-04ce11ab10a9',  // CPI-IW general index (example)
    columns: { date: 'month', value: 'cpi_iw_general' },
    plausible: (v) => v > 100 && v < 500
  },

  // Example: Petroleum products consumption (PPAC monthly)
  petroleum_consumption_dgi: {
    mode: 'csv',
    url: 'https://www.ppac.gov.in/uploads/dload/consumption.csv',
    columns: { date: 'month', value: 'total_consumption_mmt' },
    plausible: (v) => v > 10 && v < 30
  }
};

function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim().toLowerCase()] = (cells[i] || '').trim(); });
    return obj;
  });
}

function splitCsvLine(line) {
  // Minimal CSV split — handles quoted fields with embedded commas
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function pickLatestRow(rows, dateCol) {
  if (!rows.length) return null;
  // Sort by date column descending. Accept YYYY-MM-DD, YYYY-MM, or month-year strings.
  const scored = rows.map(r => {
    const raw = (r[dateCol] || '').toLowerCase();
    const d = new Date(raw);
    return { row: r, ts: Number.isFinite(d.getTime()) ? d.getTime() : 0 };
  }).filter(s => s.ts > 0);
  if (!scored.length) return rows[rows.length - 1];  // fallback: last row
  scored.sort((a, b) => b.ts - a.ts);
  return scored[0].row;
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No datagovin config for ${metric.metric_id}`);

  if (cfg.mode === 'api') {
    if (!API_KEY) throw new Error('datagovin API mode requires DATAGOVIN_API_KEY env var (free at data.gov.in)');
    const url = `https://api.data.gov.in/resource/${cfg.resource_id}?api-key=${API_KEY}&format=json&offset=0&limit=50&sort[${cfg.columns.date}]=desc`;
    const res = await fetchResilient(url, { timeoutMs: 25000, retries: 2 });
    const j = JSON.parse(res.body);
    const records = j?.records || [];
    if (!records.length) throw new Error('datagovin API: no records');
    const row = records[0];
    const value = parseFloat(row[cfg.columns.value]);
    if (Number.isNaN(value) || !cfg.plausible(value)) {
      throw new Error(`datagovin API: ${value} outside plausible band`);
    }
    return {
      value: cfg.valueTransform ? cfg.valueTransform(value) : value,
      as_of: new Date(row[cfg.columns.date]).toISOString(),
      parse_meta: { source: 'datagovin-api', resource_id: cfg.resource_id },
      raw: JSON.stringify(row).slice(0, 200)
    };
  }

  // CSV mode (no key)
  const res = await fetchResilient(cfg.url, { timeoutMs: 25000, retries: 2, browserUa: true });
  const rows = parseCsv(res.body);
  if (!rows.length) throw new Error('datagovin CSV: no rows');
  const latest = pickLatestRow(rows, cfg.columns.date.toLowerCase());
  if (!latest) throw new Error('datagovin CSV: could not pick latest row');
  const value = parseFloat(latest[cfg.columns.value.toLowerCase()]);
  if (Number.isNaN(value) || !cfg.plausible(value)) {
    throw new Error(`datagovin CSV: ${value} outside plausible band`);
  }
  try { recordSnapshot(metric.metric_id, cfg.url, res.body, value, 'datagovin_v1'); } catch {}
  return {
    value: cfg.valueTransform ? cfg.valueTransform(value) : value,
    as_of: new Date(latest[cfg.columns.date.toLowerCase()]).toISOString(),
    parse_meta: { source: 'datagovin-csv', url: cfg.url, row: latest[cfg.columns.date.toLowerCase()] },
    raw: JSON.stringify(latest).slice(0, 200)
  };
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return {
    value: primaryValue,
    source_name: cc?.name || 'datagovin-crosscheck-pending',
    parse_meta: { source: 'pending' }
  };
}

export { parseCsv, pickLatestRow, splitCsvLine };
