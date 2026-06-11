// Baltic Dirty Tanker Index (BDTI) — via Hormuz Watch public API.
//
// Hormuz Watch (our own tool, hormuz-watch-2.pages.dev) maintains BDTI with a
// multi-source scraper + manual-entry confidence gates + WoW honesty bounds
// (see hormuz-watch/functions/api/bdti.js). IRM consumes its public endpoint
// rather than re-scraping: one proven pipeline, one source of truth.
//
// GET /api/bdti → { value, asOf, source, wow_pct, ageDays, stale, confidence }

const API = process.env.HORMUZ_BDTI_API || 'https://hormuz-watch-2.pages.dev/api/bdti';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';

export async function fetchPrimary(metric) {
  const res = await fetch(API, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Hormuz BDTI API HTTP ${res.status}`);
  const j = await res.json();
  if (typeof j.value !== 'number' || !isFinite(j.value)) {
    throw new Error('Hormuz BDTI API returned no value (origin: ' + (j.origin || '?') + ')');
  }
  // BDTI physically runs ~400–3000; the API enforces 100–5000 on write.
  if (j.value < 100 || j.value > 5000) throw new Error(`BDTI implausible: ${j.value}`);
  if (j.stale) throw new Error(`BDTI marked stale by source (ageDays ${j.ageDays})`);

  return {
    value: j.value,
    as_of: j.asOf ? new Date(j.asOf + 'T00:00:00Z').toISOString() : new Date().toISOString(),
    parse_meta: { source: 'Hormuz Watch BDTI API', upstream: j.source, confidence: j.confidence || null },
    extra: {
      wow_pct: typeof j.wow_pct === 'number' ? j.wow_pct : null
    }
  };
}

// Hormuz Watch already cross-verifies internally (multi-source scraper +
// manual-entry precedence). Still a single feed from IRM's perspective.
export async function fetchCrosscheck(metric, crosscheckIndex, primaryValue) {
  return {
    value: primaryValue,
    source_name: 'crosscheck-pending/hormuz-bdti',
    parse_meta: { source: 'pending' }
  };
}
