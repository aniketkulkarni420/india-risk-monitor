#!/usr/bin/env node
// One-shot cleanup · sanitize mom_pct/yoy_pct fields after the ingest trend-
// recompute window pollution. The original recompute ran a 30-day lookup
// against a history CSV that, for monthly/weekly metrics, contained the same
// release value repeated daily — yielding misleading trend %s.
//
// Strategy here:
//   - For metrics with as_of_period in {monthly, weekly, fortnightly,
//     quarterly, policy_event} → null out trends (history insufficient)
//   - For metrics with daily/live cadence whose computed |mom| or |yoy| > 50%
//     while value isn't shock-eligible → null out (likely a recompute glitch)
//   - Leave shock-eligible metrics alone (Hormuz, Brent etc · large %s legit)
//
// Result: UI displays '—' for trends we can't honestly compute.
// Once 12-month history accumulates, ingest can recompute correctly.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'data');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && name !== 'manifest.json' && !name.startsWith('sectors')) out.push(p);
  }
  return out;
}

const NON_DAILY = new Set(['monthly', 'weekly', 'fortnightly', 'quarterly', 'policy_event']);

let touched = 0;
for (const file of walk(DATA)) {
  let m;
  try { m = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!m.metric_id) continue;

  const cadence = (m.as_of_period || '').toLowerCase();
  let resetReason = null;

  if (NON_DAILY.has(cadence)) {
    resetReason = `cadence=${cadence}`;
  } else if (m.shock_eligible) {
    // shock-eligible metrics tolerate large %s (Brent, Hormuz, VLCC…)
  } else if (typeof m.mom_pct === 'number' && Math.abs(m.mom_pct) > 50) {
    resetReason = `|mom_pct|>50 on non-shock metric (${m.mom_pct})`;
  } else if (typeof m.yoy_pct === 'number' && Math.abs(m.yoy_pct) > 50) {
    resetReason = `|yoy_pct|>50 on non-shock metric (${m.yoy_pct})`;
  }

  if (resetReason) {
    if (m.mom_pct !== null || m.yoy_pct !== null) {
      m.mom_pct = null;
      m.yoy_pct = null;
      writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8');
      touched++;
      console.log(`  ✓ reset trends · ${m.metric_id.padEnd(28)} (${resetReason})`);
    }
  }
}

console.log(`\nSanitized trends on ${touched} metrics.`);
console.log('Trends will refill correctly once 12-month history accumulates via daily ingests.');
