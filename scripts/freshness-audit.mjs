// Independent freshness audit · 2026-05-26
//
// Reads the live bundled data.json (NOT the local data/ directory) and
// reports any metric whose last_verified_at is older than its cadence allows.
// Decoupled from the noisy ingest workflow so signal isn't drowned in
// scheduled-run noise.
//
// Output:
//   - exit 0 + brief summary to stdout if all clear
//   - exit 0 + Telegram alert + GitHub issue payload to stdout if stale
//   - exit non-zero only on hard failures (network, parse) — never on
//     "things are stale" (we want the audit to ALWAYS complete and report)
//
// Usage:
//   node scripts/freshness-audit.mjs [URL]
//   node scripts/freshness-audit.mjs --json-output  → machine-readable
//   node scripts/freshness-audit.mjs --include-composites
//
// CI integration: .github/workflows/freshness-audit.yml runs this daily.

const URL = process.argv.find(a => a.startsWith('http')) || 'https://india-risk-monitor.pages.dev/dist/data.json';
const JSON_OUT = process.argv.includes('--json-output');
const INCLUDE_COMPOSITES = process.argv.includes('--include-composites');

// Cadence-aware staleness thresholds · matches composite-recompute + bundle
const STALENESS_DAYS_BY_CADENCE = {
  'Live': 2, 'Daily': 2, 'Weekly': 10, 'Fortnightly': 21,
  'Monthly': 45, 'Quarterly': 120, 'Per release': 180
};
const STALENESS_DAYS_DEFAULT = 14;
// Frozen = no proven-live fetch (last_live_fetch_at) in FROZEN_FACTOR × cadence,
// even if last_verified_at is fresh (cache-masking detector).
const FROZEN_FACTOR = parseFloat(process.env.IRM_FROZEN_FACTOR || '2');

async function fetchJson(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'IRM-FreshnessAudit/1.0', 'Accept': 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function isComposite(id) {
  return id.startsWith('driver_') || id === 'india_risk_score' || id.endsWith('_state') || id.endsWith('_regime');
}

function classifyStaleness(metric) {
  const now = Date.now();
  const lv = metric.last_verified_at;
  const freq = metric.source_primary?.frequency || 'Daily';
  const thresholdDays = STALENESS_DAYS_BY_CADENCE[freq] ?? STALENESS_DAYS_DEFAULT;
  if (!lv) return { stale: true, ageDays: null, thresholdDays, cadence: freq, reason: 'no last_verified_at' };
  const ageDays = (now - new Date(lv).getTime()) / 86400000;
  // Frozen: proven-liveness age. last_live_fetch_at advances only on genuine
  // live fetches; if it lags far behind last_verified_at, the metric is being
  // served from cache (rotted source) and is silently frozen.
  const liveStamp = metric.last_live_fetch_at;  // absent on pre-A1 data → no frozen verdict
  let frozen = false, liveAgeDays = null;
  if (liveStamp) {
    liveAgeDays = +((now - new Date(liveStamp).getTime()) / 86400000).toFixed(1);
    frozen = liveAgeDays > thresholdDays * FROZEN_FACTOR;
  }
  return {
    stale: ageDays > thresholdDays,
    severely_stale: ageDays > thresholdDays * 2,
    frozen,
    liveAgeDays,
    data_origin: metric.data_origin || null,
    ageDays: +ageDays.toFixed(1),
    thresholdDays, cadence: freq,
    last_verified_at: lv
  };
}

// ─────────────────── Main ───────────────────
let data;
try {
  data = await fetchJson(URL);
} catch (e) {
  console.error('::error::Freshness audit failed to fetch live data: ' + e.message);
  process.exit(2);
}

const stale = [];
const severelyStale = [];
const frozen = [];
let totalChecked = 0;
let healthy = 0;

for (const [id, m] of Object.entries(data.metrics || {})) {
  if (!INCLUDE_COMPOSITES && isComposite(id)) continue;
  totalChecked++;
  const result = classifyStaleness(m);
  if (result.frozen) frozen.push({ id, ...result });
  if (result.severely_stale) severelyStale.push({ id, ...result });
  else if (result.stale) stale.push({ id, ...result });
  else if (!result.frozen) healthy++;
}

const irsValue = data.metrics?.india_risk_score?.value;
const irsScoreState = data.metrics?.india_risk_score?.score_state;
const bundleAge = data.generated_at ? +((Date.now() - new Date(data.generated_at).getTime()) / 36e5).toFixed(1) : null;

const audit = {
  audited_at: new Date().toISOString(),
  source_url: URL,
  bundle_generated_at: data.generated_at,
  bundle_age_hours: bundleAge,
  total_metrics_checked: totalChecked,
  healthy_count: healthy,
  stale_count: stale.length,
  severely_stale_count: severelyStale.length,
  frozen_count: frozen.length,
  irs_value: irsValue,
  irs_score_state: irsScoreState,
  stale_metrics: stale.sort((a, b) => b.ageDays - a.ageDays),
  severely_stale_metrics: severelyStale.sort((a, b) => b.ageDays - a.ageDays),
  frozen_metrics: frozen.sort((a, b) => (b.liveAgeDays || 0) - (a.liveAgeDays || 0))
};

// C6 guard (2026-06-11) · untagged history rows = unprovable data trying to
// re-enter after the seed purge. Any appearance is a regression — RED.
let untaggedRows = 0;
try {
  const { readdirSync: rd, readFileSync: rf } = await import('node:fs');
  for (const f of rd('data/history')) {
    if (!f.endsWith('.csv')) continue;
    const lines = rf('data/history/' + f, 'utf8').trim().split('\n').slice(1);
    untaggedRows += lines.filter(l => { const p = l.split(','); return l.trim() && (p.length < 3 || p[2].trim() === ''); }).length;
  }
} catch { /* history dir absent in some contexts — skip */ }
audit.untagged_history_rows = untaggedRows;
if (untaggedRows > 0) console.log(`⚠ ${untaggedRows} UNTAGGED history rows found — seed-purge regression`);

const overallStatus =
  untaggedRows > 0 ? 'red' :
  bundleAge && bundleAge > 24 ? 'red' :
  severelyStale.length > 0 ? 'red' :
  frozen.length > 0 ? 'red' :                       // cache-masking / rotted source
  stale.length > totalChecked * 0.15 ? 'amber' :
  stale.length > 0 ? 'amber' :
  'green';
audit.overall_status = overallStatus;

if (JSON_OUT) {
  console.log(JSON.stringify(audit, null, 2));
  process.exit(0);
}

console.log(`IRM Freshness Audit · ${audit.audited_at}`);
console.log('─'.repeat(72));
console.log(`Source: ${URL}`);
console.log(`Bundle age: ${bundleAge != null ? bundleAge + 'h' : 'unknown'}`);
console.log(`IRS: ${irsValue == null ? 'NULL · ' + irsScoreState : irsValue + ' · ' + (irsScoreState || 'unknown')}`);
console.log(`Metrics: ${totalChecked} checked · ${healthy} healthy · ${stale.length} stale · ${severelyStale.length} severely stale · ${frozen.length} frozen`);
console.log(`Overall: ${overallStatus.toUpperCase()}`);

if (frozen.length) {
  console.log('\n🧊 FROZEN (last_verified fresh but no proven-live fetch — likely cache-masking / rotted source):');
  for (const f of frozen) {
    console.log(`  · ${f.id.padEnd(28)} ${f.cadence.padEnd(10)} live-age ${String(f.liveAgeDays).padEnd(8)} origin ${f.data_origin || '?'}`);
  }
}

if (severelyStale.length) {
  console.log('\n⚠️  SEVERELY STALE (>2× cadence — investigate immediately):');
  for (const s of severelyStale) {
    console.log(`  · ${s.id.padEnd(28)} ${s.cadence.padEnd(10)} age ${String(s.ageDays).padEnd(8)} threshold ${s.thresholdDays}d`);
  }
}
if (stale.length) {
  console.log('\nStale (>1× cadence, within 2×):');
  for (const s of stale.slice(0, 25)) {
    console.log(`  · ${s.id.padEnd(28)} ${s.cadence.padEnd(10)} age ${String(s.ageDays).padEnd(8)} threshold ${s.thresholdDays}d`);
  }
  if (stale.length > 25) console.log(`  · ... and ${stale.length - 25} more`);
}

// Telegram alert if amber or red
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
if (overallStatus !== 'green' && TG_TOKEN && TG_CHAT) {
  const emoji = overallStatus === 'red' ? '🔴' : '🟡';
  const lines = [
    `${emoji} IRM Freshness Audit · ${overallStatus.toUpperCase()}`,
    `Bundle age: ${bundleAge}h`,
    `IRS: ${irsValue == null ? 'NULL (' + irsScoreState + ')' : irsValue}`,
    `Stale: ${stale.length} · severely stale: ${severelyStale.length} · frozen: ${frozen.length} / ${totalChecked}`,
    ''
  ];
  if (frozen.length) {
    lines.push('🧊 Frozen (cache-masking — source may be dead):');
    for (const f of frozen.slice(0, 8)) {
      lines.push(`· ${f.id} (${f.cadence}, live-age ${f.liveAgeDays}d, origin ${f.data_origin || '?'})`);
    }
    lines.push('');
  }
  if (severelyStale.length) {
    lines.push('Severely stale:');
    for (const s of severelyStale.slice(0, 10)) {
      lines.push(`· ${s.id} (${s.cadence}, ${s.ageDays}d / ${s.thresholdDays}d)`);
    }
  }
  if (stale.length && lines.length < 18) {
    lines.push('Stale:');
    for (const s of stale.slice(0, 10)) {
      lines.push(`· ${s.id} (${s.cadence}, ${s.ageDays}d / ${s.thresholdDays}d)`);
    }
  }
  const text = lines.join('\n');
  try {
    const tg = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: TG_CHAT, text })
    });
    if (!tg.ok) console.error('Telegram send failed: ' + (await tg.text()).slice(0, 160));
    else console.log('\n→ Telegram alert sent (' + overallStatus.toUpperCase() + ')');
  } catch (e) {
    console.error('Telegram send error: ' + e.message);
  }
} else if (overallStatus !== 'green') {
  console.log('\n(Telegram credentials not configured · alert suppressed)');
}

// Exit 0 always so the workflow doesn't fail just because data is stale —
// staleness is reported via alert/issue, not via workflow-failure noise.
// Exit non-zero only on hard infrastructure failures (above).
process.exit(0);
