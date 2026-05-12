// IRM India proxy worker · Cloudflare Workers
//
// Acts as an HTTP proxy for India-restricted sources (PIB / NHAI / NSDL).
// Cloud GitHub Actions runners (US/EU IPs) call this Worker, the Worker
// fetches from Cloudflare's India edge, returns the response.
//
// Free tier: 100K requests/day. Way more than we need.
//
// Routing logic:
//   GET /proxy?url=<encoded-target-url>
//
// Security:
//   - Requires header X-Worker-Token matching env var WORKER_TOKEN
//   - Only proxies whitelisted hosts (PIB, NHAI, RBI, NSDL, etc)
//
// Deployment: see .github/workflows/deploy-cf-worker.yml

const ALLOWED_HOSTS = new Set([
  'pib.gov.in', 'www.pib.gov.in',
  'nhai.gov.in', 'www.nhai.gov.in',
  'eaindustry.nic.in',
  'rbi.org.in', 'www.rbi.org.in',
  'fpi.nsdl.co.in', 'www.fpi.nsdl.co.in',
  'cdslindia.com', 'www.cdslindia.com',
  'sebi.gov.in', 'www.sebi.gov.in',
  'nseindia.com', 'www.nseindia.com',
  'bseindia.com', 'www.bseindia.com',
  'mospi.gov.in', 'www.mospi.gov.in',
  'ppac.gov.in', 'www.ppac.gov.in',
  'data.gov.in', 'www.data.gov.in',
  'sagarmala.gov.in',
  'ipa.nic.in',
  'indianrailways.gov.in', 'www.indianrailways.gov.in',
  'dpiit.gov.in', 'www.dpiit.gov.in',
  'gst.gov.in', 'www.gst.gov.in',
  'npci.org.in', 'www.npci.org.in',
  'gridindia.in', 'www.gridindia.in',
  'cwc.gov.in', 'www.cwc.gov.in',
  'dgca.gov.in', 'www.dgca.gov.in',
  'moneycontrol.com', 'www.moneycontrol.com',
  'trendlyne.com', 'www.trendlyne.com',
  'tickertape.in', 'www.tickertape.in',
  'adaniports.com', 'www.adaniports.com'
]);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'irm-india-proxy',
        time: new Date().toISOString()
      }), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname !== '/proxy') {
      return new Response('Not found', { status: 404 });
    }

    // Auth: shared secret header
    const tokenHeader = request.headers.get('X-Worker-Token');
    if (!tokenHeader || tokenHeader !== env.WORKER_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400 });

    let targetUrl;
    try { targetUrl = new URL(target); }
    catch { return new Response('Invalid url', { status: 400 }); }

    if (!ALLOWED_HOSTS.has(targetUrl.host.toLowerCase())) {
      return new Response('Host not allowed', { status: 403 });
    }

    // Proxy fetch with browser-like headers
    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9',
          'Referer': 'https://www.google.com/'
        },
        redirect: 'follow',
        cf: {
          // Cache aggressively in CF edge to reduce hits to govt sites
          cacheTtl: 300,
          cacheEverything: true
        }
      });

      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') || 'text/html',
          'x-proxy-source': 'irm-india-proxy',
          'x-proxy-origin': targetUrl.host,
          'cache-control': 'public, max-age=300'
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 502, headers: { 'content-type': 'application/json' }
      });
    }
  }
};
