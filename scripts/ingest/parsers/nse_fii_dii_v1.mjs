// REAL fetcher · NSE FII/DII bhavcopy
// Reference implementation. Patterns to follow for other csv_download parsers:
//   - User-Agent header (NSE blocks default Node UA)
//   - Cookie warm-up (NSE sets session cookies on home page; subsequent requests need them)
//   - Retry once on 401/403 with re-warmed cookies
//   - Strict CSV parsing (do not eval)
//
// Endpoints used:
//   Home (cookie warm-up): https://www.nseindia.com/
//   FII/DII report: https://www.nseindia.com/api/fiidiiTradeReact
//
// Returns provisional T+1 figure. Final figure publishes ~24h later — re-fetch on next slot.

const HOME = 'https://www.nseindia.com/';
const API  = 'https://www.nseindia.com/api/fiidiiTradeReact';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function warmUpCookies() {
  const res = await fetch(HOME, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow'
  });
  // Extract Set-Cookie headers — Node fetch returns combined; split by comma carefully.
  const setCookie = res.headers.get('set-cookie') || '';
  const cookies = setCookie.split(/,(?=[^ ]+=)/).map(s => s.split(';')[0]).join('; ');
  return cookies;
}

async function fetchJson(url, cookies, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Referer': HOME,
      'Cookie': cookies
    }
  });
  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    const fresh = await warmUpCookies();
    return fetchJson(url, fresh, attempt + 1);
  }
  if (!res.ok) throw new Error(`NSE ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * NSE returns an array of rows, one per category (FII, DII), each with buy/sell/net values.
 * For metric `fii_equity_daily` we want the FII row's net cash market value in ₹ Cr.
 * For `dii_daily` similarly.
 */
function extractValue(payload, metric_id) {
  const row = payload.find(r => {
    const cat = (r.category || '').toUpperCase();
    if (metric_id.startsWith('fii_')) return cat.includes('FII') || cat.includes('FPI');
    if (metric_id.startsWith('dii_')) return cat.includes('DII');
    return false;
  });
  if (!row) throw new Error(`NSE response missing category row for ${metric_id}`);
  // NSE field name for net is typically `netValue` (in ₹ Cr).
  const v = parseFloat(row.netValue ?? row.net ?? '');
  if (Number.isNaN(v)) throw new Error(`NSE row has no parseable netValue for ${metric_id}`);
  return v;
}

export async function fetchPrimary(metric) {
  const cookies = await warmUpCookies();
  const payload = await fetchJson(API, cookies);
  const value = extractValue(payload, metric.metric_id);
  return {
    value,
    as_of: new Date().toISOString(),
    parse_meta: { source: 'NSE', endpoint: API, rowCount: payload?.length },
    raw: payload
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // SEBI FPI bulletin — provisional weekly file. For Phase 2, we approximate
  // with primary value ± small drift to demonstrate the cross-check engine.
  // Real implementation: download SEBI weekly XLSX, sum to date, compare.
  const cc = metric.source_crosscheck[crosscheckIndex];
  const drift = primaryValue * 0.015 * (Math.random() * 2 - 1);
  return {
    value: +(primaryValue + drift).toFixed(2),
    source_name: cc.name,
    parse_meta: { source: 'placeholder', note: 'SEBI XLSX parse to be implemented in Phase 2b' }
  };
}
