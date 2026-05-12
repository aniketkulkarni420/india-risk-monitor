// Cloudflare Worker proxy helper.
//
// When India runner is down OR a cloud runner needs to reach an
// India-restricted host, route through our CF Worker (which fetches
// from CF's India edge).
//
// Env vars (set in GitHub Actions or local .env):
//   CF_WORKER_URL    · https://irm-india-proxy.<your-subdomain>.workers.dev
//   CF_WORKER_TOKEN  · shared secret (same as WORKER_TOKEN in worker)
//
// If either env var is missing, isProxyAvailable() returns false and
// fetchViaProxy() throws PROXY_UNAVAILABLE.

const PROXY_URL = process.env.CF_WORKER_URL;
const PROXY_TOKEN = process.env.CF_WORKER_TOKEN;

export function isProxyAvailable() {
  return !!(PROXY_URL && PROXY_TOKEN);
}

export async function fetchViaProxy(targetUrl, { timeoutMs = 25000 } = {}) {
  if (!isProxyAvailable()) {
    const e = new Error('CF Worker proxy not configured (CF_WORKER_URL + CF_WORKER_TOKEN)');
    e.code = 'PROXY_UNAVAILABLE';
    throw e;
  }
  const proxyUrl = `${PROXY_URL.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(proxyUrl, {
      method: 'GET',
      headers: { 'X-Worker-Token': PROXY_TOKEN },
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`CF proxy returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.text();
    return { ok: true, body, status: res.status, source: 'cf-proxy' };
  } finally { clearTimeout(t); }
}
