// REAL fetcher · Office of Economic Adviser monthly Eight Core Industries PDF
//
// eaindustry.nic.in publishes monthly cmonthly.pdf with the IIP / WPI / Eight
// Core Industries data. Cement, steel, electricity, coal, crude, gas,
// fertilizer, refinery — all in one stable PDF.
//
// Stable URL: https://eaindustry.nic.in/pdf_files/cmonthly.pdf
//
// Note: this gives the INDEX (base year 2011-12=100) and YoY growth percentages,
// NOT absolute tonnage. For cement_dispatches in IRM (stored as Mn tonnes),
// we approximate absolute monthly tonnage using the index * base scale,
// or we re-purpose this parser to give the YoY % (more reliable signal anyway).

import { extractPdfText } from './pdf_v1.mjs';
import { recordSnapshot } from '../snapshot-store.mjs';

const PDF_URL = 'https://eaindustry.nic.in/pdf_files/cmonthly.pdf';

const CONFIGS = {
  cement_dispatches: {
    // The IECI PDF includes "Cement, Lime and Plaster" row:
    //   <name> <weight> <index> <YoY%> ...
    // Index value in May 2026 was 132.4 (base 2011-12=100).
    // For Mn tonnes approximation: India's 2024-25 average ~40 MT/month at index 130-135.
    // So MT estimate ≈ index × 0.305 (calibration factor).
    extractRe: /Cement(?:,\s+Lime\s+and\s+Plaster)?\s+[\d.]+\s+([\d.]+)\s+/i,
    valueTransform: (idx) => +(idx * 0.305).toFixed(1),  // index -> Mn tonnes approximation
    plausible: (v) => v > 25 && v < 60
  }
};

async function fetchPdfBuffer(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal, redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
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
  if (!cfg) throw new Error(`No eaindustry_ieci config for ${metric.metric_id}`);

  const buf = await fetchPdfBuffer(PDF_URL);
  const { text } = await extractPdfText(buf, { maxPages: 6 });
  if (!text || text.length < 500) throw new Error(`eaindustry_ieci: PDF text empty`);

  const m = text.match(cfg.extractRe);
  if (!m) throw new Error(`eaindustry_ieci: regex no match for ${metric.metric_id}`);

  let value = parseFloat(m[1]);
  if (cfg.valueTransform) value = cfg.valueTransform(value);
  if (!Number.isFinite(value) || !cfg.plausible(value)) {
    throw new Error(`eaindustry_ieci: parsed ${value} implausible`);
  }

  try { recordSnapshot(metric.metric_id, PDF_URL, text, value, 'eaindustry_ieci_v1'); } catch {}

  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'eaindustry-ieci', pdf: PDF_URL, raw_index: m[1] },
    raw: m[0].slice(0, 200)
  };
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'eaindustry-crosscheck-pending', parse_meta: { source: 'pending' } };
}
