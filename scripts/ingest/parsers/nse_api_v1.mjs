// REAL fetcher · NSE JSON APIs (no LLM, no Playwright).
//
// NSE exposes clean JSON endpoints that work with a plain fetch + a one-time
// cookie warmup. Verified 2026-05-14:
//   /api/block-deal        → daily block deals (sum totalTradedValue)
//   /api/fiidiiTradeReact  → FII/FPI + DII buy/sell/net (already covered by
//                            nse_fii_dii_v1; included here as a redundant tier)
//
// This parser exists because the previous block_deals_notional chain leaned
// entirely on Playwright scrapes of moneycontrol/bse/trendlyne — all JS-heavy,
// all flaky. A direct JSON API is the resilient primary.
//
// NSE blocks requests with no cookies from some IPs. We do a cheap warmup
// (GET a regular NSE page to collect cookies) then hit the API with them.

import { fetchViaProxy, isProxyAvailable } from '../cf-proxy.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// Collect NSE cookies via a cheap page GET. Returns a Cookie header string.
async function warmupCookies(referer = 'https://www.nseindia.com/') {
  try {
    const res = await fetchWithTimeout(referer, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow'
    }, 12000);
    // Node's fetch exposes set-cookie via getSetCookie() (Node 20+)
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return sc.map(c => c.split(';')[0]).join('; ');
  } catch {
    return '';
  }
}

async function fetchNseJson(apiUrl, referer) {
  // Attempt 1: raw (block-deal / fiidii often work without cookies)
  let res = await fetchWithTimeout(apiUrl, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': referer || 'https://www.nseindia.com/' }
  });
  let body = await res.text();
  if (res.ok && body && body.length > 2 && body.trim() !== '{}') {
    try { return JSON.parse(body); } catch { /* fall through to warmup */ }
  }
  // Attempt 2: with cookie warmup
  const cookies = await warmupCookies(referer);
  res = await fetchWithTimeout(apiUrl, {
    headers: {
      'User-Agent': UA, 'Accept': 'application/json',
      'Referer': referer || 'https://www.nseindia.com/',
      ...(cookies ? { 'Cookie': cookies } : {})
    }
  });
  body = await res.text();
  const looksBlocked = !res.ok || !body || body.trim() === '{}' || body.length < 3 || !body.trim().startsWith('{');
  if (!looksBlocked) {
    try { return JSON.parse(body); } catch { /* fall through to proxy */ }
  }
  // Attempt 3: CF Worker proxy (reaches NSE from CF's India edge — works from
  // foreign cloud runners where NSE bot-walls the direct request).
  if (isProxyAvailable()) {
    try {
      const { body: pbody } = await fetchViaProxy(apiUrl);
      if (pbody && pbody.trim().startsWith('{')) return JSON.parse(pbody);
    } catch { /* fall through to error */ }
  }
  if (!res.ok) throw new Error(`${apiUrl} → ${res.status}`);
  throw new Error(`${apiUrl} → empty/blocked response (NSE bot wall — needs CF Worker proxy or India IP)`);
}

const CONFIGS = {
  block_deals_notional: {
    api: 'https://www.nseindia.com/api/block-deal',
    referer: 'https://www.nseindia.com/market-data/block-deal-watch',
    extract: (j) => {
      const rows = Array.isArray(j.data) ? j.data : [];
      if (!rows.length) return null;
      // Sum notional value across all block deals for the session, → INR crore.
      let totalRaw = 0;
      for (const r of rows) {
        const v = typeof r.totalTradedValue === 'number' ? r.totalTradedValue : 0;
        totalRaw += v;
      }
      return +(totalRaw / 1e7).toFixed(1);  // rupees → crore
    },
    asOf: (j) => {
      // timestamp like "14-May-2026 14:06:56"
      if (!j.timestamp) return new Date().toISOString();
      const m = String(j.timestamp).match(/(\d{2})-(\w{3})-(\d{4})/);
      if (!m) return new Date().toISOString();
      return new Date(`${m[2]} ${m[1]}, ${m[3]}`).toISOString();
    },
    plausible: (v) => v >= 0 && v < 100000
  },

  nifty_pcr: {
    // Put-Call Ratio from the Nifty option chain — total put OI / total call OI
    // across all strikes/expiries returned. Contrarian extremes: <0.7 / >1.4.
    api: 'https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY',
    referer: 'https://www.nseindia.com/option-chain',
    extract: (j) => {
      const rows = j?.records?.data || [];
      if (!rows.length) return null;
      let putOI = 0, callOI = 0;
      for (const r of rows) {
        if (r.PE && typeof r.PE.openInterest === 'number') putOI += r.PE.openInterest;
        if (r.CE && typeof r.CE.openInterest === 'number') callOI += r.CE.openInterest;
      }
      if (callOI <= 0) return null;
      return +(putOI / callOI).toFixed(2);
    },
    asOf: (j) => {
      const t = j?.records?.timestamp;
      const m = t && String(t).match(/(\d{2})-(\w{3})-(\d{4})/);
      if (!m) return new Date().toISOString();
      return new Date(`${m[2]} ${m[1]}, ${m[3]}`).toISOString();
    },
    plausible: (v) => v > 0.3 && v < 3
  },

};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`No nse_api_v1 config for ${metric.metric_id}`);
  const j = await fetchNseJson(cfg.api, cfg.referer);
  const value = cfg.extract(j);
  if (value === null || !Number.isFinite(value)) {
    throw new Error(`nse_api_v1: ${metric.metric_id} — no extractable value from ${cfg.api}`);
  }
  if (!cfg.plausible(value)) {
    throw new Error(`nse_api_v1: ${metric.metric_id} — ${value} outside plausible band`);
  }
  return {
    value,
    as_of: cfg.asOf(j),
    parse_meta: { source: 'NSE JSON API', endpoint: cfg.api },
    raw: `NSE ${cfg.api.split('/').pop()} → ${value}`
  };
}

export async function fetchCrosscheck(metric, idx, primaryValue) {
  const cc = metric.source_crosscheck?.[idx];
  return { value: primaryValue, source_name: cc?.name || 'nse-api-crosscheck-pending', parse_meta: { source: 'pending' } };
}
