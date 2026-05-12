#!/usr/bin/env node
// Self-healing analysis · for parsers stuck red 5+ runs.
//
// Approach (free, owner-reviewed):
//   1) Walk parser-health.json — find parsers with consecutive_failures >= threshold
//   2) For each, locate last successful snapshot in data/snapshots/{metric_id}/
//   3) Fetch the current source URL fresh
//   4) Build a side-by-side report: last-success HTML vs current HTML (diff summary,
//      element-presence delta, key-phrase movement)
//   5) Optionally: if GROQ_API_KEY etc set, ask LLM to propose updated regex/selector
//   6) Write report to data/self-heal-reports/{metric_id}-{date}.md
//   7) GitHub Action posts these reports as comments on the parser-health issue
//
// Aniket reviews report, applies fix manually if it looks right. No auto-PR
// (keeps a human in the loop for what is fundamentally a creative-fix task).
//
// Run: node scripts/self-heal.mjs [--metric=foo] [--threshold=5]

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchResilient } from './ingest/fetch-resilient.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HEALTH = join(ROOT, 'data', 'parser-health.json');
const SNAP_ROOT = join(ROOT, 'data', 'snapshots');
const REPORT_DIR = join(ROOT, 'data', 'self-heal-reports');

const ARGS = parseArgs(process.argv.slice(2));
function parseArgs(argv) {
  const o = { threshold: 5 };
  for (const a of argv) {
    if (a.startsWith('--metric=')) o.metric = a.slice(9);
    else if (a.startsWith('--threshold=')) o.threshold = parseInt(a.slice(12), 10);
    else if (a === '--llm') o.useLlm = true;
  }
  return o;
}

mkdirSync(REPORT_DIR, { recursive: true });

function loadHealth() {
  if (!existsSync(HEALTH)) return { parsers: {} };
  try { return JSON.parse(readFileSync(HEALTH, 'utf8')); } catch { return { parsers: {} }; }
}

function listSnapshotsFor(metric_id) {
  const dir = join(SNAP_ROOT, metric_id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.html.gz'))
    .map(f => ({ date: f.replace('.html.gz', ''), file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function loadSnapshot(snapFile) {
  try {
    const gz = readFileSync(snapFile);
    const buf = gunzipSync(gz);
    const meta = readFileSync(snapFile.replace('.html.gz', '.json'), 'utf8');
    return { html: buf.toString('utf8'), meta: JSON.parse(meta) };
  } catch (e) {
    return null;
  }
}

function summarize(html) {
  if (!html) return { length: 0 };
  const length = html.length;
  // Top-level structural signals
  const has = (re) => re.test(html);
  return {
    length,
    has_table: has(/<table/i),
    has_form: has(/<form/i),
    has_json_ld: has(/<script[^>]+application\/ld\+json/i),
    script_count: (html.match(/<script\b/gi) || []).length,
    iframe_count: (html.match(/<iframe\b/gi) || []).length,
    likely_spa: has(/<div id="(root|app|__next)/i) || (html.match(/<div\b/gi)?.length || 0) < 30,
    title: (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim().slice(0, 120)
  };
}

function keyPhrases(html, count = 8) {
  // Pull capitalized noun-ish phrases (rough heuristic; useful for diff)
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const phrases = (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g) || [])
    .reduce((m, p) => (m.set(p, (m.get(p) || 0) + 1), m), new Map());
  return [...phrases.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([p, n]) => `${p} (${n})`);
}

async function analyzeMetric(metric_id, health_entry) {
  const snaps = listSnapshotsFor(metric_id);
  if (!snaps.length) {
    return {
      metric_id,
      verdict: 'no_snapshots',
      detail: 'No saved snapshot to diff against. Will start collecting on next success.'
    };
  }
  const lastSnap = loadSnapshot(snaps[0].file);
  if (!lastSnap) return { metric_id, verdict: 'snapshot_read_failed' };

  const url = lastSnap.meta?.url;
  if (!url) return { metric_id, verdict: 'snapshot_missing_url' };

  let current = null;
  try {
    const res = await fetchResilient(url, { timeoutMs: 25000, retries: 1, browserUa: true });
    current = res.body;
  } catch (e) {
    return { metric_id, verdict: 'fetch_failed', error: e.message, last_snap_date: snaps[0].date, url };
  }

  const a = summarize(lastSnap.html);
  const b = summarize(current);

  // Tier C addition (2026-05-12): ask LLM to compare last-good vs current.
  // Output a concrete actionable diagnosis (e.g. "regex needs update from X to Y").
  let llmDiagnosis = null;
  if (ARGS.useLlm || process.env.SELFHEAL_LLM === '1') {
    try {
      const { tryProviders } = await import('./ingest/parsers/llm_extract_v1.mjs');
      const prompt = `You are debugging a web scraper. The page used to yield value ${lastSnap.meta?.extracted_value} but now the parser fails.

LAST-GOOD SNAPSHOT (${snaps[0].date}, ${Math.round(a.length/1024)}KB):
Title: ${a.title}
Has table: ${a.has_table} · scripts: ${a.script_count}

CURRENT FETCH (${Math.round(b.length/1024)}KB):
Title: ${b.title}
Has table: ${b.has_table} · scripts: ${b.script_count}

Last-good text sample (first 1500 chars):
${(lastSnap.html || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').slice(0, 1500)}

Current text sample (first 1500 chars):
${(current || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').slice(0, 1500)}

Return JSON: { "value": null, "diagnosis": "<one-sentence root cause>", "fix_suggestion": "<concrete action: 'switch parser to X', 'update regex to Y', 'use Wayback', 'manual override'>" }`;
      const r = await tryProviders(prompt);
      if (r && (r.diagnosis || r.fix_suggestion || r.source_note)) {
        llmDiagnosis = { diagnosis: r.diagnosis || r.source_note, fix: r.fix_suggestion };
      }
    } catch {}
  }

  // Key-phrase delta — what disappeared, what appeared
  const pA = new Set(keyPhrases(lastSnap.html, 25).map(s => s.split(' (')[0]));
  const pB = new Set(keyPhrases(current, 25).map(s => s.split(' (')[0]));
  const disappeared = [...pA].filter(p => !pB.has(p));
  const appeared = [...pB].filter(p => !pA.has(p));

  return {
    metric_id,
    verdict: 'analyzed',
    url,
    last_snap_date: snaps[0].date,
    last_success_value: lastSnap.meta?.extracted_value,
    current_failure_reason: health_entry.last_failure_reason,
    consecutive_failures: health_entry.consecutive_failures,
    summary_then: a,
    summary_now: b,
    key_phrases_disappeared: disappeared.slice(0, 10),
    key_phrases_appeared: appeared.slice(0, 10),
    likely_cause: inferCause(a, b),
    llm_diagnosis: llmDiagnosis  // null if --llm flag not set or LLM unavailable
  };
}

function inferCause(a, b) {
  if (!b.length) return 'page returns empty body — possibly blocked or down';
  if (b.length < a.length * 0.3) return 'page shrunk significantly — likely 403/404/maintenance';
  if (a.has_table && !b.has_table) return 'table element disappeared — page restructured';
  if (b.likely_spa && !a.likely_spa) return 'page now appears SPA — try playwright_render_v1 parser';
  if (a.has_json_ld && !b.has_json_ld) return 'lost JSON-LD structured data';
  if (Math.abs(b.length - a.length) / a.length > 0.5) return 'major layout change — selectors likely stale';
  return 'subtle content change — review key_phrases_disappeared for missing data anchor';
}

function renderReport(analysis) {
  const lines = [];
  lines.push(`# Self-heal report · ${analysis.metric_id}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Verdict: ${analysis.verdict}`);
  lines.push('');
  if (analysis.verdict !== 'analyzed') {
    lines.push(`Detail: ${analysis.detail || analysis.error || '—'}`);
    if (analysis.url) lines.push(`URL: ${analysis.url}`);
    return lines.join('\n');
  }
  lines.push(`- URL: ${analysis.url}`);
  lines.push(`- Last good snapshot: ${analysis.last_snap_date}`);
  lines.push(`- Last good value: ${analysis.last_success_value}`);
  lines.push(`- Consecutive failures: ${analysis.consecutive_failures}`);
  lines.push(`- Current failure: \`${analysis.current_failure_reason}\``);
  lines.push('');
  lines.push(`## Likely cause`);
  lines.push('');
  lines.push(`**${analysis.likely_cause}**`);
  lines.push('');
  if (analysis.llm_diagnosis) {
    lines.push('## LLM diagnosis');
    lines.push('');
    if (analysis.llm_diagnosis.diagnosis) lines.push(`- **Root cause:** ${analysis.llm_diagnosis.diagnosis}`);
    if (analysis.llm_diagnosis.fix) lines.push(`- **Suggested fix:** ${analysis.llm_diagnosis.fix}`);
  }
  lines.push('');
  lines.push(`## Page summary diff`);
  lines.push('');
  lines.push('| Field | Then | Now |');
  lines.push('|---|---|---|');
  lines.push(`| length | ${analysis.summary_then.length} | ${analysis.summary_now.length} |`);
  lines.push(`| has table | ${analysis.summary_then.has_table} | ${analysis.summary_now.has_table} |`);
  lines.push(`| scripts | ${analysis.summary_then.script_count} | ${analysis.summary_now.script_count} |`);
  lines.push(`| iframes | ${analysis.summary_then.iframe_count} | ${analysis.summary_now.iframe_count} |`);
  lines.push(`| likely SPA | ${analysis.summary_then.likely_spa} | ${analysis.summary_now.likely_spa} |`);
  lines.push(`| title | ${analysis.summary_then.title} | ${analysis.summary_now.title} |`);
  lines.push('');
  if (analysis.key_phrases_disappeared?.length) {
    lines.push(`## Phrases that disappeared (likely lost data anchors)`);
    lines.push('');
    for (const p of analysis.key_phrases_disappeared) lines.push(`- ${p}`);
    lines.push('');
  }
  if (analysis.key_phrases_appeared?.length) {
    lines.push(`## Phrases that newly appeared`);
    lines.push('');
    for (const p of analysis.key_phrases_appeared) lines.push(`- ${p}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('Next step suggestions:');
  lines.push('');
  if (analysis.likely_cause.includes('SPA')) lines.push('- Switch parser to `html_render:playwright_render_v1`');
  if (analysis.likely_cause.includes('404') || analysis.likely_cause.includes('blocked')) lines.push('- Try Wayback Machine fallback (already wired in fetchResilient)');
  if (analysis.likely_cause.includes('restructured')) lines.push('- Update extractRe to match new key phrases');
  lines.push('- If urgent: drop a JSON file in `data/manual-overrides/` to unblock the dashboard.');
  return lines.join('\n');
}

// ── Main ──
const health = loadHealth();
const candidates = [];
for (const [metric_id, entry] of Object.entries(health.parsers || {})) {
  if (ARGS.metric && metric_id !== ARGS.metric) continue;
  if ((entry.consecutive_failures || 0) >= ARGS.threshold) {
    candidates.push([metric_id, entry]);
  }
}

console.log(`Self-heal · analyzing ${candidates.length} parser(s) failing ${ARGS.threshold}+ times in a row`);
console.log();

const written = [];
for (const [metric_id, entry] of candidates) {
  process.stdout.write(`  ${metric_id} ... `);
  const analysis = await analyzeMetric(metric_id, entry);
  const report = renderReport(analysis);
  const file = join(REPORT_DIR, `${metric_id}-${new Date().toISOString().slice(0,10)}.md`);
  writeFileSync(file, report, 'utf8');
  written.push({ metric_id, file, verdict: analysis.verdict, cause: analysis.likely_cause });
  console.log(analysis.verdict, analysis.likely_cause ? '· ' + analysis.likely_cause.slice(0, 50) : '');
}

console.log();
console.log(`Wrote ${written.length} report(s) to data/self-heal-reports/`);
console.log();

// Summary table
if (written.length) {
  console.log('Summary:');
  for (const r of written) {
    console.log(`  - ${r.metric_id}: ${r.verdict}${r.cause ? ' · ' + r.cause : ''}`);
  }
}
