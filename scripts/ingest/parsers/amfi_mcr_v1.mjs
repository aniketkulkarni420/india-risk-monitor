// AMFI Monthly Cumulative Report (MCR) XLS parser — official MF flow data.
//
// URL pattern (stable for years): https://portal.amfiindia.com/spages/am{mon}{yyyy}repo.xls
// e.g. ammay2026repo.xls. Walks back up to 3 months for publish lag (~10th).
//
// Metrics served:
//   mf_net_equity_flows — "Sub Total - II" (Growth/Equity Oriented Schemes,
//     open-ended) net inflow, ₹ Cr. Self-checked: mobilized − repurchase ≈ net.
//
// (net_sip_inflows comes from news tiers — AMFI's new CMS publishes the SIP
//  contribution figure as an image; every outlet quotes the exact number.)

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function urlFor(year, monthIdx) {
  return `https://portal.amfiindia.com/spages/am${MONTHS[monthIdx]}${year}repo.xls`;
}

function toNum(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return NaN;
  const t = s.replace(/,/g, '').replace(/\s/g, '');
  if (t === '-' || t === '') return NaN;
  return parseFloat(t);
}

export async function fetchPrimary(metric) {
  if (metric.metric_id !== 'mf_net_equity_flows') {
    throw new Error(`amfi_mcr_v1 not configured for ${metric.metric_id}`);
  }
  const XLSX = require('xlsx');

  // Walk back from current month (report for month M appears ~M+1 10th)
  const now = new Date();
  let buf = null, repYear = null, repMonth = null;
  for (let back = 1; back <= 4; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const url = urlFor(d.getUTCFullYear(), d.getUTCMonth());
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 20000) continue; // error page, not the report
      buf = Buffer.from(ab);
      repYear = d.getUTCFullYear(); repMonth = d.getUTCMonth();
      break;
    } catch { continue; }
  }
  if (!buf) throw new Error('AMFI MCR: no report found in last 4 months');

  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets['MCR_MonthlyReport'] || wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  // Open-ended Growth/Equity subtotal row: "Sub Total - II"
  const row = grid.find(r => (r || []).some(c =>
    typeof c === 'string' && /Sub\s*Total\s*-\s*II\b/i.test(c)));
  if (!row) throw new Error('AMFI MCR: Sub Total - II row not found');

  // Numeric cells in order: schemes, folios, mobilized, repurchase, net, ...
  const nums = row.map(toNum).filter(Number.isFinite);
  if (nums.length < 5) throw new Error('AMFI MCR: equity subtotal row malformed');
  const [/*schemes*/, /*folios*/, mobilized, repurchase, net] = nums;

  // Self-check: the identity must hold (catches column drift in future formats)
  if (Math.abs((mobilized - repurchase) - net) > Math.max(5, Math.abs(net) * 0.01)) {
    throw new Error(`AMFI MCR: column drift — mobilized−repurchase=${(mobilized - repurchase).toFixed(1)} ≠ net=${net}`);
  }
  if (Math.abs(net) > 200000) throw new Error(`AMFI MCR: implausible net equity flow ${net}`);

  const asOf = new Date(Date.UTC(repYear, repMonth + 1, 0)).toISOString();
  return {
    value: Math.round(net * 100) / 100,
    as_of: asOf,
    parse_meta: { source: 'AMFI MCR XLS', period: `${MONTHS[repMonth]} ${repYear}` },
    extra: {
      period_label: new Date(Date.UTC(repYear, repMonth, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      equity_mobilized_cr: mobilized,
      equity_repurchase_cr: repurchase
    }
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Real independent crosscheck: news headlines quote the same AMFI figure
  // ("Equity mutual fund inflows fall to Rs 22,908 crore in May"). Try RSS.
  try {
    const q = encodeURIComponent('equity mutual fund inflows crore AMFI');
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
      { headers: { 'User-Agent': UA } });
    const t = await res.text();
    const titles = [...t.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]);
    // Only accept headlines naming the report month (last completed month) —
    // otherwise a stale prior-month figure "confirms" the wrong period.
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const rep = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
    const monthRe = new RegExp('\\b' + MONTH_NAMES[rep.getUTCMonth()].slice(0, 3), 'i');
    for (const title of titles) {
      if (!monthRe.test(title)) continue;
      const m = title.match(/equity\s+(?:mutual\s+)?fund\s+inflows?[^0-9₹]{0,40}(?:₹|Rs\.?\s*)([\d,]+(?:\.\d+)?)\s*crore/i);
      if (!m) continue;
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(v) && Math.abs(v) < 200000) {
        return { value: v, source_name: 'Google News (AMFI coverage)', parse_meta: { source: 'news-rss' } };
      }
    }
  } catch { /* fall through to pending */ }
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/amfi-news',
    parse_meta: { source: 'pending' }
  };
}
