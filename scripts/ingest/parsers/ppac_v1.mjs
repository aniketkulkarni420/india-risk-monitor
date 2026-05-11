// REAL fetcher · PPAC monthly petroleum consumption PDF
//
// PPAC (Petroleum Planning & Analysis Cell, MoPNG) publishes monthly fuel
// consumption data as PDF reports at:
//   https://www.ppac.gov.in/consumption/petroleum-products
//
// The index page links to dated PDFs like:
//   https://ppac.gov.in/download.php?file=menu/<hash>_PT_Consumption.pdf
//
// The PDF contains a single-page table with a TOTAL row giving the latest
// month's all-India consumption in '000 metric tonnes. We divide by 1000
// to get MMT (the metric's stored unit).

import { fetchResilient } from '../fetch-resilient.mjs';
import { extractPdfText } from './pdf_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const INDEX_URL = 'https://www.ppac.gov.in/consumption/petroleum-products';

const CONFIGS = {
  pol_demand: {
    // Find latest PT_Consumption PDF from index page
    pdfMatchRe: /href="(https?:\/\/ppac\.gov\.in\/download\.php\?file=[^"]*PT_Consumption[^"]*\.pdf)"/i,
    // The TOTAL row contains the latest month's value as the first non-zero figure
    // Format: "TOTAL <month1_val> <m2> <m3> ... <month12> <annual_total>"
    extractRe: /TOTAL\s+(\d{4,6})\s/i,
    // Stored unit is MMT (Mn tonnes); PDF gives '000 MT, so / 1000
    valueTransform: (v) => +(v / 1000).toFixed(2),
    plausible: (v) => v > 15 && v < 30
  }
};

async function fetchPdfBuffer(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*'
      }
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally { clearTimeout(t); }
}

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No ppac_v1 config for ${metric.metric_id}`);

  // Step 1: fetch index page, find PT_Consumption PDF link
  const indexRes = await fetchResilient(INDEX_URL, {
    timeoutMs: 25000, retries: 2, wayback: false, browserUa: true
  });
  const m = indexRes.body.match(cfg.pdfMatchRe);
  if (!m) throw new Error(`ppac_v1: PT_Consumption PDF link not found on index`);
  const pdfUrl = m[1];

  // Step 2: download + extract
  const buf = await fetchPdfBuffer(pdfUrl);
  const { text } = await extractPdfText(buf, { maxPages: 3 });
  if (!text || text.length < 100) throw new Error(`ppac_v1: empty PDF text`);

  // Step 3: regex for TOTAL value
  const valMatch = text.match(cfg.extractRe);
  if (!valMatch) throw new Error(`ppac_v1: TOTAL row not matched`);
  let value = parseFloat(valMatch[1]);
  if (cfg.valueTransform) value = cfg.valueTransform(value);

  if (Number.isNaN(value) || !cfg.plausible(value)) {
    throw new Error(`ppac_v1: parsed ${value} outside plausible band`);
  }

  try { recordSnapshot(metric.metric_id, pdfUrl, text, value, 'ppac_v1'); } catch {}

  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'ppac-pdf', index: INDEX_URL, pdf: pdfUrl, regex: cfg.extractRe.toString() },
    raw: valMatch[0].slice(0, 200)
  };
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'ppac-crosscheck-pending', parse_meta: { source: 'pending' } };
}
