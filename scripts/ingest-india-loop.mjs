#!/usr/bin/env node
// Loop runner for the India self-hosted runner. Iterates over the list of
// metrics that need India IP, invoking `node scripts/ingest.mjs --live --metric=X`
// for each. Continue-on-failure so one stuck metric doesn't kill the run.
//
// Why a Node script? The Windows self-hosted runner has flaky shell options
// (pwsh not installed · powershell blocked by ExecutionPolicy · bash not in
// PATH). Node is the only universally-available scripting environment, and
// the runner just used it to npm install.

import { spawnSync } from 'node:child_process';

const METRICS = [
  'wacr_repo_spread',
  'pol_demand',
  'air_pax',
  'india_port_dwell_time',
  'eway_bills',
  'fastag_toll',
  'rail_freight',
  'port_cargo',
  'cement_dispatches',
  'upi_value',
  'india_crude_basket',
  'naukri_jobspeak',
  // Restored 2026-05-12 with tiered fallback chains
  'fno_oi_buildup',
  'block_deals_notional',
  'fpi_debt_flows'
];

let succeeded = 0;
let failed = 0;
const startMs = Date.now();

for (const m of METRICS) {
  console.log();
  console.log('========================================');
  console.log('Ingesting:', m);
  console.log('========================================');
  const t0 = Date.now();
  // shell:true required on Windows for npm.cmd resolution via PATH
  const r = spawnSync(
    'npm',
    ['run', 'ingest', '--', '--live', `--metric=${m}`],
    { stdio: 'inherit', shell: true }
  );
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`  -> ${m} OK in ${took}s`);
    succeeded++;
  } else {
    console.log(`  -> ${m} FAILED (exit ${r.status}, ${took}s) · continuing`);
    failed++;
  }
}

const totalMin = ((Date.now() - startMs) / 60000).toFixed(1);
console.log();
console.log('================================');
console.log(`India-loop done · ${succeeded} ok · ${failed} failed · ${totalMin} min`);
console.log('================================');
// Always exit 0 — individual failures already logged; workflow continues to validate + commit step
process.exit(0);
