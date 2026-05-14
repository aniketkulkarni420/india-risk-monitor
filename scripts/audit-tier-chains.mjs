// Tier-chain integrity audit · 2026-05-14
//
// WHY THIS EXISTS
// Tier chains in metric JSONs rotted silently: chains referenced parsers that
// were never registered (baltic_dirty_v1, rbi_wss_v1, cwc_v1), or listed two
// "tiers" that both hit the same upstream URL (ccil_v1 + tradingeconomics_v1 →
// identical TradingEconomics page = fake independence). Nothing caught it
// until metrics silently went dead. This audit makes that impossible.
//
// CHECKS (per metric):
//   1. source_primary.parser resolves to a registered parser (or is manual:/mock)
//   2. every tier_chain entry resolves to a registered parser
//   3. independence — a tiered metric should have >=2 DISTINCT origin classes
//      in its chain (otherwise all tiers can fail together)
//
// EXIT CODE: non-zero if any ERROR-level violation (unregistered parser).
// Independence is a WARNING, not a hard fail (some metrics legitimately have
// one good source).
//
// USAGE:
//   node scripts/audit-tier-chains.mjs            · full report
//   node scripts/audit-tier-chains.mjs --strict   · independence warnings → errors
//   node scripts/audit-tier-chains.mjs --quiet    · only print violations

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRealParsers } from './ingest/registry.mjs';
import { classOfParser } from './ingest/source-origin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');
const ARGS = new Set(process.argv.slice(2));
const STRICT = ARGS.has('--strict');
const QUIET = ARGS.has('--quiet');

const REGISTERED = new Set(listRealParsers());

// Parser prefixes that don't need a registered implementation:
//   manual:* — derived or override, handled specially
//   mock:*   — explicit mock
//   tiered:* — the orchestrator itself (its chain entries are checked instead)
function isExempt(parserId) {
  return /^(manual|mock|tiered):/.test(parserId);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (['snapshots', 'manual-overrides', 'history', 'source-cache', 'self-heal-reports'].includes(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && !name.startsWith('sectors') &&
             !['manifest.json', 'parser-health.json', 'source-cooldown.json', 'llm-telemetry.json'].includes(name)) {
      out.push(p);
    }
  }
  return out;
}

const errors = [];
const warnings = [];
let checked = 0;

for (const file of walk(DATA)) {
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!j.metric_id || !j.source_primary) continue;
  checked++;

  const id = j.metric_id;
  const parser = j.source_primary.parser;
  const chain = j.source_primary.tier_chain;

  // Check 1: primary parser is registered (unless exempt)
  if (!isExempt(parser) && !REGISTERED.has(parser)) {
    errors.push(`${id}: source_primary.parser "${parser}" is NOT registered`);
  }

  // Check 2: every tier_chain entry is registered
  if (Array.isArray(chain)) {
    for (const tier of chain) {
      if (isExempt(tier)) continue;
      if (!REGISTERED.has(tier)) {
        errors.push(`${id}: tier_chain entry "${tier}" is NOT registered (phantom tier)`);
      }
    }

    // Check 3: independence — distinct origin classes
    if (chain.length >= 2) {
      const classes = new Set(chain.map(classOfParser));
      if (classes.size < 2) {
        const msg = `${id}: tier_chain has ${chain.length} tiers but only 1 origin class (${[...classes][0]}) — no real independence, all tiers can fail together`;
        if (STRICT) errors.push(msg); else warnings.push(msg);
      }
    }
  } else if (parser.startsWith('tiered:')) {
    errors.push(`${id}: parser is tiered:* but tier_chain is missing or not an array`);
  }
}

// ── Report ──
if (!QUIET) {
  console.log(`Tier-chain integrity audit · ${checked} metrics checked`);
  console.log('─'.repeat(64));
}

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} independence warning(s):`);
  for (const w of warnings) console.log(`   ${w}`);
}

if (errors.length) {
  console.log(`\n✗  ${errors.length} integrity ERROR(s):`);
  for (const e of errors) console.log(`   ${e}`);
  console.log(`\nResult: FAIL — ${errors.length} error(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  process.exit(1);
}

console.log(`\nResult: PASS — 0 errors${warnings.length ? `, ${warnings.length} warning(s)` : ''} across ${checked} metrics`);
process.exit(0);
