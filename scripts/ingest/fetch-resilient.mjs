// Resilient fetch helper · shared across parsers.
//
// Features:
//   - Retry with exponential backoff (1s, 5s, 25s) + jitter
//   - User-agent + referer warmup to bypass naive bot detection
//   - Timeout per request
//   - Optional Wayback Machine fallback when primary URL 404s
//   - Optional Google Cache fallback when primary 403s
//   - Returns body + final URL + status for parser-side decisions
//
// Usage:
//   const { body, source } = await fetchResilient(url, { timeoutMs, retries, wayback });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 IRM-Ingest/1.0';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * (ms * 0.3));

async function rawFetch(url, { timeoutMs = 25000, headers = {}, browserUa = false } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': browserUa ? UA_BROWSER : UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        ...headers
      },
      signal: ac.signal,
      redirect: 'follow'
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, url: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch with retry + backoff. Returns { ok, body, status, source } on success
 * or throws after exhausting retries.
 *
 * @param {string} url
 * @param {object} opts
 *   @param {number} opts.timeoutMs - per-attempt timeout
 *   @param {number} opts.retries - max retries (default 2 → 3 total attempts)
 *   @param {boolean} opts.wayback - fall back to web.archive.org on 404
 *   @param {boolean} opts.googleCache - fall back to googleusercontent on 403
 *   @param {boolean} opts.browserUa - use Chrome UA (helps against simple bot walls)
 *   @param {object} opts.headers - extra headers
 */
export async function fetchResilient(url, opts = {}) {
  const {
    timeoutMs = 25000,
    retries = 2,
    wayback = true,
    googleCache = false,
    browserUa = false,
    headers = {}
  } = opts;

  let lastErr;
  // Retry primary with backoff
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await rawFetch(url, { timeoutMs, headers, browserUa });
      if (res.ok && res.body && res.body.length > 0) {
        return { ...res, source: 'primary', attempt };
      }
      // 4xx → break out for fallbacks (don't waste retries on 404)
      if (res.status >= 400 && res.status < 500) {
        lastErr = new Error(`${url} → ${res.status}`);
        break;
      }
      lastErr = new Error(`${url} → ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) {
      const delay = jitter([1000, 5000, 25000][attempt] || 25000);
      await sleep(delay);
    }
  }

  // Fallback 1: Wayback Machine (great for URL rot + 404)
  if (wayback) {
    try {
      const waybackUrl = await resolveWayback(url, timeoutMs);
      if (waybackUrl) {
        const res = await rawFetch(waybackUrl, { timeoutMs, browserUa: true });
        if (res.ok && res.body) return { ...res, source: 'wayback', attempt: -1, original_url: url };
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // Fallback 2: Google webcache (often killed but free to try)
  if (googleCache) {
    try {
      const gcUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
      const res = await rawFetch(gcUrl, { timeoutMs, browserUa: true });
      if (res.ok && res.body) return { ...res, source: 'google_cache', attempt: -1, original_url: url };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error(`${url}: all attempts + fallbacks failed`);
}

/**
 * Resolve a URL to its latest Wayback snapshot URL.
 * Uses the free CDX/Availability API. Returns null if no snapshot exists.
 */
async function resolveWayback(url, timeoutMs = 15000) {
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(api, { signal: ac.signal });
    if (!res.ok) return null;
    const j = await res.json();
    const snap = j?.archived_snapshots?.closest;
    if (snap && snap.available && snap.url) return snap.url;
    return null;
  } finally {
    clearTimeout(t);
  }
}

export { resolveWayback };
