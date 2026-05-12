// Cloudflare Pages Function — hourly snapshot refresh
//
// Called by GitHub Actions cron every hour. Fetches all available data sources
// in parallel, normalizes into a single Hormuz snapshot, writes to CF KV.
// /api/snapshot reads from KV first; falls back to env vars if KV empty.
//
// Auth: caller must include header `X-Cron-Secret: ${CRON_SECRET}` matching the
// CF Pages env var. Prevents anonymous abuse.
//
// Sources (all free):
//   1. EIA Brent (RBRTE)  via existing /api/eia proxy · always works if EIA_KEY set
//   2. GFW dark vessels   via existing /api/gfw proxy · 4h refresh from upstream
//   3. AISHub vessel count · optional · needs AISHUB_KEY env var
//   4. Reuters Shipping RSS · qualitative regime read · LLM extraction (future)
//
// Output schema (written to KV key "hormuz:snapshot:latest"):
//   {
//     as_of, fetched_at,
//     daily_transit_estimate, baseline_30d, pct_of_normal,
//     vessel_count_inbound, vessel_count_outbound, total_active,
//     dark_vessels, bdti, incidents_30d, india_import_dependency_pct,
//     brent_usd_per_bbl, brent_dod_pct,
//     sources_called: { eia: bool, gfw: bool, aishub: bool, reuters: bool },
//     source: "hormuz-watch · V2 cron · {hh}:{mm}Z",
//     errors: [...]
//   }

const KV_KEY = 'hormuz:snapshot:latest';

export async function onRequest({ request, env }) {
  // Auth
  if (env.CRON_SECRET) {
    const provided = request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret');
    if (provided !== env.CRON_SECRET) return json({ error: 'auth required' }, 401);
  }

  if (!env.OIL_KV) {
    return json({ error: 'OIL_KV namespace not bound · check wrangler.toml + Pages bindings' }, 500);
  }

  const errors = [];
  const out = {
    as_of: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    // Defaults from env-var overrides (V1 fallback values)
    daily_transit_estimate: numFromEnv(env.HORMUZ_TRANSITS_24H, 84),
    baseline_30d: numFromEnv(env.HORMUZ_BASELINE_30D, 140),
    vessel_count_inbound: numFromEnv(env.HORMUZ_INBOUND, 38),
    vessel_count_outbound: numFromEnv(env.HORMUZ_OUTBOUND, 42),
    dark_vessels: numFromEnv(env.HORMUZ_DARK, 947),
    bdti: numFromEnv(env.HORMUZ_BDTI, 14),
    incidents_30d: numFromEnv(env.HORMUZ_INCIDENTS, 58),
    india_import_dependency_pct: 58.0,
    sources_called: { eia: false, gfw: false, aishub: false, reuters: false },
    source: 'hormuz-watch · V2 cron'
  };

  // Parallel fetch all available sources
  const [eiaR, gfwR, aishubR] = await Promise.allSettled([
    fetchEiaBrent(env),
    fetchGfwDarkVessels(env, request),
    fetchAishubTransitCount(env)
  ]);

  // EIA Brent · always tries
  if (eiaR.status === 'fulfilled' && eiaR.value) {
    out.brent_usd_per_bbl = eiaR.value.value;
    out.brent_dod_pct = eiaR.value.dod_pct;
    out.brent_date = eiaR.value.date;
    out.sources_called.eia = true;
  } else if (eiaR.status === 'rejected') {
    errors.push({ source: 'eia', error: String(eiaR.reason).slice(0, 200) });
  }

  // GFW dark vessels · upstream is 4h refresh
  if (gfwR.status === 'fulfilled' && gfwR.value) {
    out.dark_vessels = gfwR.value.count;
    out.gfw_window_hours = gfwR.value.window_hours;
    out.sources_called.gfw = true;
  } else if (gfwR.status === 'rejected') {
    errors.push({ source: 'gfw', error: String(gfwR.reason).slice(0, 200) });
  }

  // AISHub transit count · only if AISHUB_KEY set
  if (aishubR.status === 'fulfilled' && aishubR.value) {
    out.daily_transit_estimate = aishubR.value.count;
    out.aishub_observation_window = aishubR.value.window;
    out.sources_called.aishub = true;
    out.source = 'hormuz-watch · V2 cron · AISHub + EIA + GFW';
  } else if (aishubR.status === 'rejected') {
    errors.push({ source: 'aishub', error: String(aishubR.reason).slice(0, 200) });
  }

  // Derive pct_of_normal + total_active from final values
  out.total_active = out.vessel_count_inbound + out.vessel_count_outbound;
  out.pct_of_normal = +((out.daily_transit_estimate / out.baseline_30d) * 100).toFixed(1);
  out.errors = errors;

  // Detect if ANY live source actually returned data
  const liveCount = Object.values(out.sources_called).filter(Boolean).length;
  out.is_static = liveCount === 0;
  out.live_source_count = liveCount;

  // Write to KV (TTL 6h · cron updates hourly so this is a generous floor)
  try {
    await env.OIL_KV.put(KV_KEY, JSON.stringify(out), { expirationTtl: 21600 });
  } catch (e) {
    errors.push({ source: 'kv-write', error: String(e).slice(0, 200) });
    return json({ ...out, kv_write_error: String(e) }, 500);
  }

  return json({
    ...out,
    debug: {
      kv_key: KV_KEY,
      kv_ttl_seconds: 21600,
      cron_endpoint_version: 'v2.0'
    }
  });
}

// EIA Brent · uses existing /api/eia internal proxy
async function fetchEiaBrent(env) {
  if (!env.EIA_KEY) throw new Error('EIA_KEY not configured');
  const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${encodeURIComponent(env.EIA_KEY)}&frequency=daily&data%5B0%5D=value&facets%5Bseries%5D%5B%5D=RBRTE&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc&offset=0&length=2`;
  const r = await fetch(url, { cf: { cacheTtl: 1800 } });
  if (!r.ok) throw new Error(`EIA ${r.status}`);
  const j = await r.json();
  const rows = j?.response?.data || j?.data || [];
  if (rows.length < 2) throw new Error('EIA returned < 2 rows');
  const today = parseFloat(rows[0].value);
  const yest = parseFloat(rows[1].value);
  return {
    value: today,
    dod_pct: +(((today - yest) / yest) * 100).toFixed(2),
    date: rows[0].period
  };
}

// GFW dark vessels · uses existing /api/gfw flow
// The existing gfw.js function makes auth'd POSTs to GFW v3 events. We can
// call it directly via internal fetch within the same Pages project.
async function fetchGfwDarkVessels(env, request) {
  if (!env.GFW_TOKEN) throw new Error('GFW_TOKEN not configured');
  const origin = new URL(request.url).origin;
  const r = await fetch(`${origin}/api/gfw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ region: 'hormuz', hours: 24 })
  });
  if (!r.ok) throw new Error(`GFW proxy ${r.status}`);
  const j = await r.json();
  return {
    count: j?.dark_vessels_count ?? j?.count ?? 0,
    window_hours: j?.window_hours ?? 24
  };
}

// AISHub free community AIS · http GET to their REST endpoint
// Aniket needs to sign up at aishub.net and set AISHUB_KEY env var
// We query for vessels inside the Hormuz bounding box and count tankers transiting
async function fetchAishubTransitCount(env) {
  if (!env.AISHUB_KEY) throw new Error('AISHUB_KEY not configured · sign up at aishub.net');
  // Hormuz bounding box · approx 26.0–26.9°N, 55.5–57.0°E
  const url = `https://data.aishub.net/ws.php?username=${encodeURIComponent(env.AISHUB_KEY)}&format=1&output=json&compress=0&latmin=26.0&latmax=26.9&lonmin=55.5&lonmax=57.0`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`AISHub ${r.status}`);
  const j = await r.json();
  // AISHub returns array · first row is metadata, rest are vessels
  if (!Array.isArray(j) || j.length < 1) throw new Error('AISHub empty response');
  const meta = j[0] || {};
  if (meta.ERROR) throw new Error(`AISHub error: ${meta.ERROR_MESSAGE || meta.ERROR}`);
  const vessels = j.slice(1);
  // Filter tankers/cargo · AIS ship type codes 70-89 = cargo · 80-89 = tanker
  const tankers = vessels.filter(v => v.TYPE >= 70 && v.TYPE <= 89);
  // AISHub gives current snapshot · count is "currently in box" not "daily transits"
  // Multiplying snapshot by approx 6x gives rough daily transit estimate
  // (avg transit takes ~4 hours through the strait)
  const dailyEstimate = Math.round(tankers.length * 6);
  return {
    count: dailyEstimate,
    window: 'instantaneous_x6',
    snapshot_count: tankers.length,
    total_vessels_in_box: vessels.length
  };
}

function numFromEnv(envVar, fallback) {
  if (envVar == null || envVar === '') return fallback;
  const n = Number(envVar);
  return Number.isFinite(n) ? n : fallback;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
