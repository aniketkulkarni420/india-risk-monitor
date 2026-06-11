// Hormuz Watch public API parser — canonical source for oil-chain metrics.
//
// Hormuz Watch (our own tool, hormuz-watch-2.pages.dev) runs AIS-based transit
// estimation + multi-source cross-verified oil prices with its own confidence
// gates. IRM consumes its public endpoints instead of re-scraping weaker
// sources — one proven pipeline, one source of truth (2026-06-11, per Aniket).
//
//   hormuz_throughput → GET /api/snapshot  (transits_per_day, near-real-time)
//   brent_crude       → GET /api/oil       (brent.level, cross-verified 2 sources)

const BASE = process.env.HORMUZ_WATCH_API || 'https://hormuz-watch-2.pages.dev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Hormuz Watch ${path} HTTP ${res.status}`);
  return res.json();
}

const CONFIGS = {
  hormuz_throughput: {
    fetch: async () => {
      const j = await getJson('/api/snapshot');
      const v = j.transits_per_day ?? j.daily_transit_estimate;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('snapshot has no transits_per_day');
      if (v < 0 || v > 600) throw new Error(`implausible transits/day: ${v}`);
      // SANITY GUARD (2026-06-11): during the closure the estimator emitted
      // 331/day while tracking ZERO active vessels — an estimate with no
      // observational basis. Reject when the estimate is positive but the
      // tool sees no vessels at all; the manual override / fallback tiers
      // (and the human) know better than an unanchored extrapolation.
      const active = (j.total_active ?? 0) + (j.vessel_count_inbound ?? 0) + (j.vessel_count_outbound ?? 0);
      if (v > 50 && active === 0) {
        throw new Error(`snapshot estimate ${v}/day with zero tracked vessels — no observational basis, rejected`);
      }
      return {
        value: v,
        as_of: j.as_of || new Date().toISOString(),
        extra: {
          pct_of_normal: j.pct_of_normal ?? null,
          baseline_30d: j.baseline_30d ?? null,
          throughput_mbd_est: j.throughput_mbd_est ?? null,
          incidents_30d: j.incidents_30d ?? null,
          ukmto_attacks_30d: j.ukmto_attacks_30d ?? null
        },
        source_note: 'AIS transit estimate'
      };
    }
  },

  brent_crude: {
    fetch: async () => {
      const j = await getJson('/api/oil');
      const b = j.brent || {};
      if (typeof b.level !== 'number' || !Number.isFinite(b.level)) throw new Error('oil API has no brent.level');
      if (b.level < 20 || b.level > 250) throw new Error(`implausible brent: ${b.level}`);
      if (j.stale) throw new Error(`oil API marked stale (${j.staleMin} min)`);
      return {
        value: b.level,
        as_of: new Date().toISOString(),
        extra: {
          _brent_sources: Array.isArray(b.sources) ? b.sources.join('+') : null,
          _brent_confidence: b.confidence || null,
          _brent_min: b.min ?? null,
          _brent_max: b.max ?? null
        },
        source_note: `cross-verified · ${b.sources?.length || 1} sources · ${b.confidence || '?'} confidence`,
        // Genuinely multi-source upstream: min/max provide the crosscheck spread
        crosscheckable: Array.isArray(b.sources) && b.sources.length >= 2
      };
    }
  }
};

export async function fetchPrimary(metric) {
  const cfg = CONFIGS[metric.metric_id];
  if (!cfg) throw new Error(`hormuz_watch_v1 not configured for ${metric.metric_id}`);
  const r = await cfg.fetch();
  return {
    value: r.value,
    as_of: r.as_of,
    parse_meta: { source: 'hormuz-watch API', note: r.source_note },
    ...(r.extra ? { extra: r.extra } : {})
  };
}

export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  // brent is cross-verified UPSTREAM (2 independent feeds inside Hormuz Watch);
  // report the upstream second-source median as a real crosscheck when present.
  if (metric.metric_id === 'brent_crude') {
    try {
      const j = await getJson('/api/oil');
      if (Array.isArray(j.brent?.sources) && j.brent.sources.length >= 2 && typeof j.brent.median === 'number') {
        return {
          value: j.brent.median,
          source_name: 'Hormuz Watch upstream second source (' + j.brent.sources.join('+') + ')',
          parse_meta: { source: 'hormuz-watch-xverify' }
        };
      }
    } catch { /* fall through */ }
  }
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/hormuz-watch',
    parse_meta: { source: 'pending' }
  };
}
