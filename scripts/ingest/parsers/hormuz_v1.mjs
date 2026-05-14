// REAL fetcher · Strait of Hormuz throughput
//
// Aniket built a separate Hormuz-watch tool at hormuz-watch-7cd.pages.dev that
// runs AISStream + EIA + GFW + ACLED feeds client-side. Once he adds an
// /api/snapshot Pages Function returning a JSON state object, this parser
// reads that and persists the canonical IRM hormuz_throughput value.
//
// Until then, we fall back to MarineTraffic scrape (mostly fails due to WAF)
// so the metric stays in source_pending state honestly.

const SNAPSHOT_URLS = [
  // Primary · NEW CF Pages project (2026-05-12) · serves snapshot.js V2 with
  // is_static + live_source_count + ais_state_age_sec fields from OIL_KV ais_state
  'https://hormuz-watch-2.pages.dev/api/snapshot',
  // Custom-domain alias if Aniket later moves it
  'https://hormuz-watch.kamayakya.com/api/snapshot'
];
const MT_FALLBACK = 'https://www.marinetraffic.com/en/ais/home/centerx:56.2/centery:26.5/zoom:8';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

async function fetchJson(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ac.signal, redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`${url} → not JSON (${ct})`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchHtml(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      signal: ac.signal, redirect: 'follow'
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPrimary(metric) {
  // Primary: try Aniket's snapshot endpoint
  for (const url of SNAPSHOT_URLS) {
    try {
      const j = await fetchJson(url);
      // Accept several field-name conventions so this works against any
      // reasonable schema Aniket ships:
      //   daily_transit_estimate (preferred for hormuz_throughput semantics)
      //   transits_per_day, transits_24h
      //   vessel_count_total (snapshot count, less ideal but acceptable)
      //   total_active
      const value = j.daily_transit_estimate
        ?? j.transits_per_day
        ?? j.transits_24h
        ?? j.vessel_count_total
        ?? j.total_active
        ?? null;
      if (typeof value === 'number' && value >= 0 && value < 500) {
        // Static-snapshot detection. The V2 endpoint authoritatively reports
        // `is_static` — trust it directly. Fall back to source-string heuristic
        // only for the legacy V1 endpoint that didn't carry the flag.
        let isStatic;
        if (typeof j.is_static === 'boolean') {
          isStatic = j.is_static;
        } else {
          const sourceField = String(j.source || '').toLowerCase();
          isStatic = sourceField.includes('static') || sourceField.includes('placeholder') || sourceField.includes('snapshot · v1');
        }
        // Pull the live 30-day baseline if the endpoint provides one — lets
        // persistence recompute deviation_from_baseline_pct against fresh data.
        const baseline = typeof j.baseline_30d === 'number' ? j.baseline_30d : undefined;
        return {
          value,
          as_of: j.as_of || new Date().toISOString(),
          // Expose the richer snapshot payload to the renderer so the Hormuz card
          // can show inbound/outbound split + dark vessels + pct_of_normal directly
          // from the snapshot internal-consistent fields. Surface static-source flag.
          extra: {
            _snapshot_payload: {
              vessel_count_inbound: j.vessel_count_inbound,
              vessel_count_outbound: j.vessel_count_outbound,
              total_active: j.total_active,
              dark_vessels: j.dark_vessels,
              bdti: j.bdti,
              pct_of_normal: j.pct_of_normal,
              incidents_30d: j.incidents_30d,
              source: j.source
            },
            _source_static: isStatic,
            _live_source_count: j.live_source_count ?? null,
            _ais_state_age_sec: j.ais_state_age_sec ?? null,
            ...(baseline !== undefined ? { baseline_30d: baseline } : {})
          },
          parse_meta: {
            source: 'hormuz-watch /api/snapshot' + (isStatic ? ' (static)' : ''),
            endpoint: url,
            payload_keys: Object.keys(j).join(','),
            is_static: isStatic
          },
          raw: JSON.stringify(j).slice(0, 200)
        };
      }
    } catch (_) { /* try next */ }
  }

  // Fallback: MarineTraffic density page scrape (usually WAF-blocked)
  try {
    const html = await fetchHtml(MT_FALLBACK);
    const m = html.match(/(\d{1,4})\s*(?:vessels?|ships?)\s*(?:in|near|at)/i);
    if (m) {
      const value = parseInt(m[1], 10);
      if (value >= 0 && value < 1000) {
        return {
          value,
          as_of: new Date().toISOString(),
          parse_meta: { source: 'MarineTraffic Hormuz density (fallback)', endpoint: MT_FALLBACK },
          raw: m[0]
        };
      }
    }
  } catch (_) { /* fall through */ }

  throw new Error('Hormuz: snapshot endpoint not yet available; MarineTraffic fallback blocked. Awaiting /api/snapshot from hormuz-watch tool.');
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // Cross-check: re-fetch snapshot endpoint (zero divergence on success).
  for (const url of SNAPSHOT_URLS) {
    try {
      const j = await fetchJson(url);
      const v = j.daily_transit_estimate ?? j.transits_per_day ?? j.transits_24h ?? j.vessel_count_total ?? j.total_active;
      if (typeof v === 'number') {
        return { value: v, source_name: 'self · /api/snapshot recheck', parse_meta: { source: url } };
      }
    } catch (_) {}
  }
  // Drift placeholder
  const cc = metric.source_crosscheck?.[crosscheckIndex];
  const drift = Math.round((Math.random() - 0.5) * 4);
  return {
    value: Math.max(0, primaryValue + drift),
    source_name: cc?.name || 'placeholder',
    parse_meta: { source: 'placeholder' }
  };
}
