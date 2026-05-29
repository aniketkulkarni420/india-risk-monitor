// IRM India proxy + INDEPENDENT WATCHDOG · Cloudflare Workers
//
// TWO jobs:
//
// 1) HTTP proxy (original) — fetch India-restricted sources from CF's India
//    edge for cloud GitHub Actions runners. GET /proxy?url=<encoded>.
//
// 2) Watchdog (added 2026-05-29) — a Cron Trigger fires scheduled() every few
//    hours. It pulls the LIVE deployed data.json, runs the same GO/NO-GO logic
//    as scripts/showcase-ready.mjs, and:
//      • Telegrams immediately on any problem (deduped).
//      • Auto-heals: triggers a fresh ingest (workflow_dispatch) — bounded to
//        MAX_HEALS_PER_DAY via KV so it can't loop.
//      • Sends a daily "green heartbeat" so SILENCE itself is the alarm (if you
//        stop getting the heartbeat, the watchdog is dead → investigate).
//      • Pings healthchecks.io every run — a dead-man's switch for the watchdog
//        itself. If the Worker stops running, healthchecks alerts you.
//
//    This lives on Cloudflare — a DIFFERENT platform from GitHub Actions +
//    CF Pages — so even if ingest, the GH crons, and the Pages deploy ALL die,
//    this still checks the live site and screams.
//
// Required Worker secrets/vars (see SETUP_FULLPROOF.md):
//   WORKER_TOKEN          · proxy auth (existing)
//   TELEGRAM_BOT_TOKEN    · alerts + heartbeat
//   TELEGRAM_CHAT_ID
//   GH_DISPATCH_TOKEN     · fine-grained PAT, Actions:write — for auto-heal
//   GH_REPO               · "owner/repo" e.g. aniketkulkarni420/india-risk-monitor
//   HEALTHCHECK_URL       · healthchecks.io ping URL (optional)
//   LIVE_DATA_URL         · default https://india-risk-monitor.pages.dev/dist/data.json
//   HEARTBEAT_HOUR_UTC    · hour (0-23) to send the daily green heartbeat (default 4 = 09:30 IST)
// KV binding:
//   IRM_STATE             · heal counters, heartbeat dedupe, alert dedupe

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

// ── Watchdog config (mirrors scripts/showcase-ready.mjs) ──────────────────
const DEFAULT_LIVE_URL = 'https://india-risk-monitor.pages.dev/dist/data.json';
const STALE_DAYS = { Live: 2, Daily: 2, Weekly: 10, Fortnightly: 21, Monthly: 45, Quarterly: 120, 'Per release': 180 };
const STALE_DEFAULT = 14;
const FROZEN_FACTOR = 2;
const MAX_HEALS_PER_DAY = 2;
const BOUNDS = {
  inr_usd: [75, 105, 'INR/USD'],
  brent_crude: [30, 160, 'Brent $/bbl'],
  india_crude_basket: [30, 160, 'India crude basket'],
  nifty_50: [15000, 35000, 'Nifty'],
  bank_nifty: [35000, 75000, 'Bank Nifty'],
  india_vix: [5, 60, 'India VIX'],
  nifty_pe_5y: [12, 32, 'Nifty PE'],
  cpi_inflation: [0, 15, 'CPI %'],
  repo_rate: [3, 9, 'Repo %'],
  gsec_curve: [4, 12, '10Y G-Sec %'],
  fx_reserves: [400, 800, 'FX reserves $bn'],
  gst_gross: [120000, 320000, 'GST cr'],
  india_risk_score: [0, 100, 'IRS']
};

function isComposite(id) {
  return id.startsWith('driver_') || id === 'india_risk_score' || id.endsWith('_state') || id.endsWith('_regime');
}

// Pure GO/NO-GO evaluation over the bundled data.json.
function checkReadiness(data) {
  const now = Date.now();
  const fails = [], warns = [];

  const bundleAgeH = data.generated_at ? (now - new Date(data.generated_at).getTime()) / 36e5 : Infinity;
  if (bundleAgeH > 24) fails.push(`bundle ${bundleAgeH.toFixed(1)}h old (>24h) — deploy/ingest stuck`);
  else if (bundleAgeH > 12) warns.push(`bundle ${bundleAgeH.toFixed(1)}h old`);

  const stale = [], severe = [], frozen = [];
  for (const [id, m] of Object.entries(data.metrics || {})) {
    if (isComposite(id)) continue;
    const freq = (m.source_primary && m.source_primary.frequency) || 'Daily';
    const th = STALE_DAYS[freq] ?? STALE_DEFAULT;
    if (m.last_live_fetch_at) {
      const liveAge = (now - new Date(m.last_live_fetch_at).getTime()) / 864e5;
      if (liveAge > th * FROZEN_FACTOR) frozen.push(`${id} (live ${liveAge.toFixed(1)}d/${th}d, ${m.data_origin || '?'})`);
    }
    const lv = m.last_verified_at;
    if (!lv) { severe.push(id); continue; }
    const age = (now - new Date(lv).getTime()) / 864e5;
    if (age > th * 2) severe.push(`${id} (${age.toFixed(1)}d/${th}d)`);
    else if (age > th) stale.push(`${id} (${age.toFixed(1)}d/${th}d)`);
  }
  const total = Object.keys(data.metrics || {}).length;
  if (frozen.length) fails.push(`${frozen.length} frozen (cache-masking): ${frozen.slice(0, 5).join(', ')}`);
  if (severe.length) fails.push(`${severe.length} severely stale: ${severe.slice(0, 6).join(', ')}`);
  if (stale.length > total * 0.10) fails.push(`${stale.length} metrics stale (>10%)`);
  else if (stale.length) warns.push(`${stale.length} mildly stale`);

  const irs = data.metrics && data.metrics.india_risk_score;
  if (!irs || irs.value == null) fails.push(`IRS is NULL (${irs && irs.score_state})`);

  for (const [id, b] of Object.entries(BOUNDS)) {
    const m = data.metrics && data.metrics[id];
    if (!m || m.value == null) continue;
    const v = m.value;
    if (typeof v !== 'number' || !isFinite(v)) { fails.push(`${b[2]} not finite: ${v}`); continue; }
    if (v < b[0] || v > b[1]) fails.push(`${b[2]}=${v} outside [${b[0]},${b[1]}]`);
  }

  let nullCount = 0;
  for (const [id, m] of Object.entries(data.metrics || {})) {
    if (isComposite(id)) continue;
    if (m.value == null || (typeof m.value === 'number' && !isFinite(m.value))) nullCount++;
  }
  if (nullCount > 3) fails.push(`${nullCount} metrics null/NaN`);

  return {
    verdict: fails.length === 0 ? 'GO' : 'NO-GO',
    go: fails.length === 0,
    checked_at: new Date(now).toISOString(),
    bundle_age_hours: +bundleAgeH.toFixed(1),
    irs: irs ? irs.value : null,
    stale_count: stale.length, severe_count: severe.length, frozen_count: frozen.length,
    blockers: fails, warnings: warns
  };
}

async function fetchLiveData(env) {
  const url = env.LIVE_DATA_URL || DEFAULT_LIVE_URL;
  const res = await fetch(url, { headers: { 'User-Agent': 'IRM-Watchdog/1.0', 'Accept': 'application/json' }, cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error(`live data HTTP ${res.status}`);
  return res.json();
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: 'true' })
    });
    return r.ok;
  } catch { return false; }
}

async function pingHealthcheck(env, ok) {
  if (!env.HEALTHCHECK_URL) return;
  try { await fetch(env.HEALTHCHECK_URL + (ok ? '' : '/fail'), { method: 'GET' }); } catch {}
}

// Auto-heal: trigger a fresh full ingest via workflow_dispatch. Bounded by KV.
async function triggerHeal(env) {
  // Optional faster-cadence heal. If no PAT is configured the GitHub
  // freshness-audit workflow heals instead (ambient GITHUB_TOKEN, 3×/day).
  if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return { healed: false, reason: 'deferred to GitHub audit (no Worker PAT)' };
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  if (env.IRM_STATE) {
    count = parseInt((await env.IRM_STATE.get(`heals:${today}`)) || '0', 10);
    if (count >= MAX_HEALS_PER_DAY) return { healed: false, reason: `daily heal cap (${MAX_HEALS_PER_DAY}) reached` };
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/ingest.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_DISPATCH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'IRM-Watchdog',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ ref: 'main', inputs: { slot: 'all' } })
    });
    if (!r.ok) return { healed: false, reason: `dispatch HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
    if (env.IRM_STATE) await env.IRM_STATE.put(`heals:${today}`, String(count + 1), { expirationTtl: 172800 });
    return { healed: true, count: count + 1 };
  } catch (e) { return { healed: false, reason: e.message }; }
}

async function runWatchdog(env) {
  let data, verdict, fetchOk = true;
  try {
    data = await fetchLiveData(env);
    verdict = checkReadiness(data);
  } catch (e) {
    fetchOk = false;
    verdict = { go: false, verdict: 'NO-GO', blockers: ['could not load live data: ' + e.message], bundle_age_hours: null, irs: null, stale_count: 0, severe_count: 0, frozen_count: 0, warnings: [] };
  }

  // Dead-man's switch ping. If live data unreachable, ping /fail so healthchecks
  // alerts; otherwise success (proves the watchdog ran).
  await pingHealthcheck(env, fetchOk);

  const today = new Date().toISOString().slice(0, 10);

  if (!verdict.go) {
    // Dedupe: only alert once per (day + blocker signature) to avoid spamming
    // the same NO-GO every cron tick.
    const sig = today + '|' + verdict.blockers.join('|').slice(0, 200);
    let already = false;
    if (env.IRM_STATE) { already = (await env.IRM_STATE.get('lastalert')) === sig; }
    const heal = await triggerHeal(env);
    if (!already) {
      const lines = [
        `🔴 IRM Watchdog · NO-GO`,
        `bundle: ${verdict.bundle_age_hours == null ? 'unreachable' : verdict.bundle_age_hours + 'h'} · IRS: ${verdict.irs == null ? 'NULL' : verdict.irs}`,
        `frozen ${verdict.frozen_count} · severe ${verdict.severe_count} · stale ${verdict.stale_count}`,
        '',
        'Blockers:',
        ...verdict.blockers.slice(0, 8).map(b => '· ' + b),
        '',
        heal.healed ? `🔧 Auto-heal triggered (ingest slot=all, ${heal.count}/${MAX_HEALS_PER_DAY} today)` : `⚠️ Auto-heal NOT run: ${heal.reason}`
      ];
      await sendTelegram(env, lines.join('\n'));
      if (env.IRM_STATE) await env.IRM_STATE.put('lastalert', sig, { expirationTtl: 172800 });
    }
    return verdict;
  }

  // GO · clear any stale alert dedupe + send the daily green heartbeat once/day.
  if (env.IRM_STATE) await env.IRM_STATE.delete('lastalert');
  const heartbeatHour = parseInt(env.HEARTBEAT_HOUR_UTC || '4', 10);
  const hourNow = new Date().getUTCHours();
  if (hourNow === heartbeatHour && env.IRM_STATE) {
    const sent = await env.IRM_STATE.get('heartbeat');
    if (sent !== today) {
      await sendTelegram(env, `✅ IRM GO · IRS ${verdict.irs} · bundle ${verdict.bundle_age_hours}h · ${verdict.stale_count} mild-stale · 0 frozen\n(daily heartbeat — if this stops arriving, the watchdog is down)`);
      await env.IRM_STATE.put('heartbeat', today, { expirationTtl: 172800 });
    }
  } else if (!env.IRM_STATE && hourNow === heartbeatHour) {
    // No KV → best-effort heartbeat (may double-send within the hour)
    await sendTelegram(env, `✅ IRM GO · IRS ${verdict.irs} · bundle ${verdict.bundle_age_hours}h (daily heartbeat)`);
  }
  return verdict;
}

export default {
  // ── Cron Trigger entrypoint ──────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWatchdog(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check (worker liveness)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'irm-india-proxy+watchdog', time: new Date().toISOString() }), { headers: { 'content-type': 'application/json' } });
    }

    // On-demand readiness — lets you (or the dashboard) curl the live verdict.
    if (url.pathname === '/status') {
      try {
        const data = await fetchLiveData(env);
        const verdict = checkReadiness(data);
        return new Response(JSON.stringify(verdict, null, 2), {
          status: verdict.go ? 200 : 503,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ go: false, error: e.message }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
    }

    // Manual watchdog trigger (auth-gated) — for testing the alert/heal path.
    if (url.pathname === '/run-watchdog') {
      if (request.headers.get('X-Worker-Token') !== env.WORKER_TOKEN) return new Response('Unauthorized', { status: 401 });
      const verdict = await runWatchdog(env);
      return new Response(JSON.stringify(verdict, null, 2), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname !== '/proxy') {
      return new Response('Not found', { status: 404 });
    }

    // ── Proxy (original) ──────────────────────────────────────────────────
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
        cf: { cacheTtl: 300, cacheEverything: true }
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
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
  }
};
