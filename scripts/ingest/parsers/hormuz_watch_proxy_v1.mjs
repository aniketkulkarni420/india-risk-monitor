// hormuz-watch proxy crosscheck parser · 2026-05-12
//
// Aniket's hormuz-watch tool at hormuz-watch-7cd.pages.dev exposes 2 LIVE
// upstream proxies that we can use as cross-check sources for freight metrics:
//
//   /api/stooq  → EIA Brent daily (authoritative · "EIA:RBRTE:daily")
//   /api/oil    → FinnHub Brent/WTI ETF proxy (BNO/USO change %)
//
// This module provides cross-check fetchers for `brent_crude`. The Hormuz
// throughput itself can't be cross-checked here — /api/snapshot is static
// (see hormuz_v1.mjs). For Hormuz, real fix requires either fixing the
// hormuz-watch backend or wiring TankerTrackers/AISStream directly.

const HW_BASE = 'https://hormuz-watch-2.pages.dev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

async function fetchJson(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ac.signal, redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Cross-check for brent_crude: pull EIA Brent daily via hormuz-watch /api/stooq
// Payload: { today, yesterday, todayDate, yesterdayDate, change, pct, source }
export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  if (metric.metric_id !== 'brent_crude') {
    return {
      value: primaryValue,
      source_name: 'hormuz-watch proxy (not wired for ' + metric.metric_id + ')',
      parse_meta: { source: 'not-applicable' }
    };
  }
  try {
    const j = await fetchJson(`${HW_BASE}/api/stooq`);
    if (typeof j.today === 'number' && j.today > 30 && j.today < 200) {
      const divergencePct = primaryValue ? Math.abs((j.today - primaryValue) / primaryValue * 100) : null;
      return {
        value: j.today,
        source_name: 'EIA:RBRTE:daily via hormuz-watch',
        parse_meta: {
          source: 'hormuz-watch /api/stooq',
          eia_date: j.todayDate,
          eia_yesterday: j.yesterday,
          eia_dod_pct: j.pct,
          divergence_vs_primary_pct: divergencePct
        }
      };
    }
    throw new Error('stooq returned non-numeric or out-of-band value');
  } catch (err) {
    // Fallback: drift placeholder · preserves prior behavior on failure
    const drift = (Math.random() - 0.5) * 2;
    return {
      value: Math.max(0, primaryValue + drift),
      source_name: 'placeholder (hormuz-watch /api/stooq unavailable)',
      parse_meta: { source: 'placeholder', error: String(err).slice(0, 120) }
    };
  }
}

// Optional: fetch the snapshot endpoint metadata to assess if Hormuz is still
// static. Bundle.mjs reads _source_static; this lets a future ingest run
// auto-refresh that flag rather than relying on metric JSON authoring.
export async function probeHormuzSnapshot() {
  try {
    const j = await fetchJson(`${HW_BASE}/api/snapshot`);
    const sourceField = String(j.source || '').toLowerCase();
    return {
      is_static: sourceField.includes('static') || sourceField.includes('placeholder') || sourceField.includes('snapshot · v1'),
      source_label: j.source,
      payload: j
    };
  } catch (err) {
    return { is_static: null, error: String(err) };
  }
}
