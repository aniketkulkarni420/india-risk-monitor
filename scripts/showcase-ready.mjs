// Showcase-readiness check · 2026-05-29
//
// ONE command to answer "is it safe to show this to someone right now?"
// Reads the LIVE deployed data.json and runs every guarantee in one pass:
//   1. Bundle recency        · is the deploy fresh?
//   2. Freshness (cadence)    · any metric past its cadence window?
//   3. IRS computed           · headline number present, not null?
//   4. Value plausibility     · any metric outside sane bounds (decimal/unit error)?
//   5. Cross-source sanity    · key metrics within range of an independent feed
//   6. Null/NaN scan          · any broken values where a number is expected?
//
// Exit 0 = GO (safe to showcase). Exit 1 = NO-GO (lists exactly what's wrong).
//
// Usage:
//   node scripts/showcase-ready.mjs                  · check live site
//   node scripts/showcase-ready.mjs --local          · check local app/dist/data.json
//   node scripts/showcase-ready.mjs --json           · machine-readable
//
// This is the "before I demo" button. Run it, see GREEN, show with confidence.

const LIVE_URL = 'https://india-risk-monitor.pages.dev/dist/data.json';
const args = new Set(process.argv.slice(2));
const LOCAL = args.has('--local');
const JSON_OUT = args.has('--json');

const STALE_DAYS = { Live: 2, Daily: 2, Weekly: 10, Fortnightly: 21, Monthly: 45, Quarterly: 120, 'Per release': 180 };
const STALE_DEFAULT = 14;
const FROZEN_FACTOR = parseFloat(process.env.IRM_FROZEN_FACTOR || '2');

// Data-VINTAGE allowance: how old may the data point itself (as_of) be, given
// publication lag? Different question from retrieval staleness — a parser can
// fetch "successfully" every day yet keep re-confirming a years-old release
// (observed: fastag_toll as_of 2024-01-01 stamped verified in 2026). These
// bounds are generous for real publication lags but catch vintage rot.
const VINTAGE_DAYS = { Live: 7, Daily: 7, Weekly: 21, Fortnightly: 35, Monthly: 75, Quarterly: 160, 'Per release': 270 };
const VINTAGE_DEFAULT = 75;

// Plausibility bounds for the headline metrics a viewer would scan first.
// Wide enough to allow crisis values, tight enough to catch decimal/unit errors.
// (INR 95 is real here — bound 75-105 allows it but rejects 9.5 or 950.)
const BOUNDS = {
  inr_usd:        [75, 105,  'INR/USD'],
  brent_crude:    [30, 160,  'Brent $/bbl'],
  india_crude_basket: [30, 160, 'India crude basket $/bbl'],
  nifty_50:       [15000, 35000, 'Nifty'],
  bank_nifty:     [35000, 75000, 'Bank Nifty'],
  india_vix:      [5, 60,    'India VIX'],
  nifty_pe_5y:    [12, 32,   'Nifty PE'],
  cpi_inflation:  [0, 15,    'CPI %'],
  core_cpi:       [1.5, 9,   'core CPI %'],
  repo_rate:      [3, 9,     'Repo %'],
  gsec_curve:     [4, 12,    '10Y G-Sec %'],
  fx_reserves:    [400, 800, 'FX reserves $bn'],
  gst_gross:      [120000, 320000, 'GST ₹cr'],
  hormuz_throughput: [0, 200, 'Hormuz transits/day'],
  india_risk_score: [0, 100, 'IRS']
};

function isComposite(id) {
  return id.startsWith('driver_') || id === 'india_risk_score' || id.endsWith('_state') || id.endsWith('_regime');
}

async function getData() {
  if (LOCAL) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(new URL('../app/dist/data.json', import.meta.url), 'utf8'));
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(LIVE_URL, { headers: { 'User-Agent': 'IRM-ShowcaseReady/1.0' }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

let data;
try { data = await getData(); }
catch (e) { console.error('NO-GO · could not load data: ' + e.message); process.exit(1); }

const now = Date.now();
const fails = [];   // blockers
const warns = [];   // non-blocking

// 1 · bundle recency
const bundleAgeH = data.generated_at ? (now - new Date(data.generated_at).getTime()) / 36e5 : Infinity;
if (bundleAgeH > 24) fails.push(`bundle is ${bundleAgeH.toFixed(1)}h old (>24h) — deploy pipeline may be stuck`);
else if (bundleAgeH > 12) warns.push(`bundle is ${bundleAgeH.toFixed(1)}h old (>12h)`);

// 1b · C6 guard (2026-06-11): no untagged history rows (seed-purge regression),
//      and no metric sparkline longer than its real-history month count.
try {
  const { readdirSync: rd, readFileSync: rf, existsSync: ex } = await import('node:fs');
  let untagged = 0;
  const realMonths = {};
  if (ex('data/history')) for (const f of rd('data/history')) {
    if (!f.endsWith('.csv')) continue;
    const lines = rf('data/history/' + f, 'utf8').trim().split('\n').slice(1).filter(Boolean);
    const bad = lines.filter(l => { const p = l.split(','); return p.length < 3 || p[2].trim() === ''; });
    untagged += bad.length;
    const months = new Set(lines.filter(l => !bad.includes(l)).map(l => l.slice(0, 7)));
    realMonths[f.replace('.csv', '')] = months.size;
  }
  if (untagged > 0) fails.push(`${untagged} untagged history rows — unprovable data re-entered after seed purge`);
  for (const [id, m] of Object.entries(data.metrics || {})) {
    const sl = Array.isArray(m.sparkline_12m) ? m.sparkline_12m.length : 0;
    const rm = realMonths[id];
    if (rm !== undefined && sl > rm) fails.push(`${id}: sparkline has ${sl} points but only ${rm} real history months — fabricated points`);
  }
} catch (e) { warns.push('C6 history-integrity check skipped: ' + e.message); }

// 2 · freshness (cadence-aware) + frozen-liveness (cache-masking detector)
//     + data-vintage (as_of age — catches "fresh fetch of an ancient release")
let stale = [], severe = [], frozen = [], oldVintage = [];
for (const [id, m] of Object.entries(data.metrics || {})) {
  if (isComposite(id)) continue;
  const freq = m.source_primary?.frequency || 'Daily';
  const th = STALE_DAYS[freq] ?? STALE_DEFAULT;
  const lv = m.last_verified_at;
  // Frozen: no proven-live fetch in >FROZEN_FACTOR× cadence even if last_verified is fresh.
  if (m.last_live_fetch_at) {
    const liveAge = (now - new Date(m.last_live_fetch_at).getTime()) / 86400000;
    if (liveAge > th * FROZEN_FACTOR) frozen.push(`${id} (live-age ${liveAge.toFixed(1)}d/${th}d, origin ${m.data_origin || '?'})`);
  }
  // Vintage: the data point itself is older than any plausible publication lag.
  // Manual overrides are exempt from the BLOCKER (a human explicitly attested
  // the value); they surface as warnings instead.
  if (m.as_of) {
    const vth = VINTAGE_DAYS[freq] ?? VINTAGE_DEFAULT;
    const vAge = (now - new Date(m.as_of).getTime()) / 86400000;
    if (vAge > vth) {
      const isOverride = m.verification_state === 'manual_override' || m._verification_state_original === 'manual_override';
      if (isOverride) warns.push(`${id}: manual override dated ${String(m.as_of).slice(0, 10)} (${vAge.toFixed(0)}d old) — consider re-issuing`);
      else oldVintage.push(`${id} (data dated ${String(m.as_of).slice(0, 10)} · ${vAge.toFixed(0)}d/${vth}d)`);
    }
  }
  if (!lv) { severe.push(id); continue; }
  const age = (now - new Date(lv).getTime()) / 86400000;
  if (age > th * 2) severe.push(`${id} (${age.toFixed(1)}d/${th}d)`);
  else if (age > th) stale.push(`${id} (${age.toFixed(1)}d/${th}d)`);
}
if (oldVintage.length) fails.push(`${oldVintage.length} metrics show OLD DATA (as_of beyond publication lag): ${oldVintage.slice(0, 6).join(', ')}${oldVintage.length > 6 ? '…' : ''}`);
if (frozen.length) fails.push(`${frozen.length} frozen (cache-masking — source likely dead): ${frozen.slice(0, 6).join(', ')}${frozen.length > 6 ? '…' : ''}`);
if (severe.length) fails.push(`${severe.length} severely stale (>2× cadence): ${severe.slice(0, 8).join(', ')}${severe.length > 8 ? '…' : ''}`);
if (stale.length > (Object.keys(data.metrics).length * 0.10)) fails.push(`${stale.length} metrics stale (>10% of total)`);
else if (stale.length) warns.push(`${stale.length} metrics mildly stale: ${stale.slice(0, 6).join(', ')}`);

// 3 · IRS computed
const irs = data.metrics?.india_risk_score;
if (irs?.value == null) fails.push(`India Risk Score is NULL (score_state: ${irs?.score_state}) — headline number missing`);

// 4 · plausibility bounds
for (const [id, [lo, hi, label]] of Object.entries(BOUNDS)) {
  const m = data.metrics?.[id];
  if (!m || m.value == null) continue;
  const v = m.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) { fails.push(`${label} is not a finite number: ${v}`); continue; }
  if (v < lo || v > hi) fails.push(`${label} = ${v} outside plausible [${lo}, ${hi}] — likely decimal/unit error`);
}

// 5 · cross-source sanity (INR — the one we can independently verify cheaply)
if (!LOCAL) {
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ac.signal });
    clearTimeout(t);
    const j = await r.json();
    const refInr = j?.rates?.INR;
    const ourInr = data.metrics?.inr_usd?.value;
    if (refInr && ourInr && Math.abs(refInr - ourInr) / refInr > 0.05) {
      fails.push(`INR cross-source mismatch: ours ${ourInr} vs independent ${refInr.toFixed(2)} (>5% apart)`);
    }
  } catch { warns.push('INR cross-source check skipped (forex API unreachable)'); }
}

// 6 · null/NaN scan across all non-composite metrics
let nullCount = 0;
for (const [id, m] of Object.entries(data.metrics || {})) {
  if (isComposite(id)) continue;
  if (m.value == null || (typeof m.value === 'number' && !Number.isFinite(m.value))) nullCount++;
}
if (nullCount > 3) fails.push(`${nullCount} non-composite metrics have null/NaN values`);
else if (nullCount) warns.push(`${nullCount} metrics have null values`);

// ── Verdict ──
const go = fails.length === 0;
const result = {
  verdict: go ? 'GO' : 'NO-GO',
  checked_at: new Date().toISOString(),
  source: LOCAL ? 'local app/dist/data.json' : LIVE_URL,
  bundle_age_hours: +bundleAgeH.toFixed(1),
  irs: irs?.value ?? null,
  blockers: fails,
  warnings: warns
};

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(go ? 0 : 1); }

const bar = '═'.repeat(60);
console.log(bar);
console.log(`  SHOWCASE READINESS: ${go ? '✅ GO — safe to show' : '🔴 NO-GO — fix before showing'}`);
console.log(bar);
console.log(`  source:      ${result.source}`);
console.log(`  bundle age:  ${result.bundle_age_hours}h`);
console.log(`  IRS:         ${result.irs ?? 'NULL'}`);
if (fails.length) {
  console.log(`\n  BLOCKERS (${fails.length}):`);
  fails.forEach(f => console.log(`   🔴 ${f}`));
}
if (warns.length) {
  console.log(`\n  warnings (${warns.length}, non-blocking):`);
  warns.forEach(w => console.log(`   🟡 ${w}`));
}
if (go && !warns.length) console.log('\n  All checks green. Show it.');
console.log('');
process.exit(go ? 0 : 1);
