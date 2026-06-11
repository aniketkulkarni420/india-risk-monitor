// Index of Eight Core Industries (ICI) — official OEA/DPIIT XLSX.
//
// Discovery: https://eaindustry.nic.in/ links the full series workbook as
// eight_core_infra/Core_Industries_2011_12_<yyyymmdd>.xlsx (suffix changes per
// release, so we scrape the homepage for the current link).
//
// Workbook: 'Index' sheet (monthly index per industry since Apr-2011) and
// 'Growth (%)' sheet (YoY growth per industry + overall).
//
// Value contract for eight_core_industries: OVERALL YoY growth % for the
// latest month. extras carry all 8 industry growth rates (drawer breakdown)
// and the overall index level.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';
const HOME = 'https://eaindustry.nic.in/';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const INDUSTRIES = ['coal', 'crude_oil', 'natural_gas', 'refinery_products', 'fertilizers', 'steel', 'cement', 'electricity'];

async function discoverXlsxUrl() {
  const res = await fetch(HOME, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`eaindustry home HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/href="(eight_core_infra\/Core_Industries_2011_12_\d+\.xlsx)"/i);
  if (!m) throw new Error('ICI XLSX link not found on eaindustry.nic.in');
  return HOME + m[1];
}

function parseMonthLabel(s) {
  const m = String(s).trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
  if (!m || MONTHS[m[1]] == null) return null;
  return { month: MONTHS[m[1]], year: 2000 + parseInt(m[2], 10) };
}

export async function fetchPrimary(metric) {
  if (metric.metric_id !== 'eight_core_industries') {
    throw new Error(`ici_xlsx_v1 not configured for ${metric.metric_id}`);
  }
  const XLSX = require('xlsx');
  const url = await discoverXlsxUrl();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`ICI XLSX HTTP ${res.status}`);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });

  const growth = XLSX.utils.sheet_to_json(wb.Sheets['Growth (%)'], { header: 1, raw: false });
  const index = XLSX.utils.sheet_to_json(wb.Sheets['Index'], { header: 1, raw: false });

  // Latest month rows (skip FY-total rows like "2025-26")
  const growthRows = growth.filter(r => r && parseMonthLabel(r[0]) && r[1] != null && r[1] !== '');
  if (!growthRows.length) throw new Error('ICI: no monthly growth rows parsed');
  const last = growthRows[growthRows.length - 1];
  const prev = growthRows[growthRows.length - 2] || null;
  const period = parseMonthLabel(last[0]);

  const overall = parseFloat(last[1]);
  if (!Number.isFinite(overall) || Math.abs(overall) > 30) {
    throw new Error(`ICI: implausible overall growth ${last[1]}`);
  }

  const industries = {};
  INDUSTRIES.forEach((k, i) => {
    const v = parseFloat(last[2 + i]);
    industries[k] = Number.isFinite(v) ? v : null;
  });

  const idxRows = index.filter(r => r && parseMonthLabel(r[0]) && r[1] != null && r[1] !== '');
  const lastIdx = idxRows.length ? parseFloat(idxRows[idxRows.length - 1][1]) : null;

  const asOf = new Date(Date.UTC(period.year, period.month + 1, 0)).toISOString();
  return {
    value: overall,
    as_of: asOf,
    parse_meta: { source: 'OEA ICI XLSX', url, period: String(last[0]).trim() },
    extra: {
      period_label: String(last[0]).trim(),
      prev_month_growth_pct: prev ? parseFloat(prev[1]) : null,
      overall_index: Number.isFinite(lastIdx) ? lastIdx : null,
      industry_growth: industries
    }
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Release-day PIB/news coverage quotes the same overall figure.
  try {
    const q = encodeURIComponent('eight core industries growth India');
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { 'User-Agent': UA } });
    const t = await res.text();
    const titles = [...t.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]);
    for (const title of titles) {
      const m = title.match(/core\s+(?:industries|sector)[^0-9-]{0,40}(-?[\d.]+)\s*(?:%|per\s*cent)/i);
      if (!m) continue;
      const v = parseFloat(m[1]);
      if (Number.isFinite(v) && Math.abs(v - primaryValue) < 3) {
        return { value: v, source_name: 'Google News (ICI coverage)', parse_meta: { source: 'news-rss' } };
      }
    }
  } catch { /* fall through */ }
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/ici-news',
    parse_meta: { source: 'pending' }
  };
}
