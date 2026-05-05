#!/usr/bin/env node
// Bundle all metric JSONs into a single fast-load file at app/dist/data.json.
// Phase 5 dependency. Renderer fetches this once instead of 70 individual files.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const OUT = join(ROOT, 'app', 'dist', 'data.json');

mkdirSync(dirname(OUT), { recursive: true });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && name !== 'manifest.json') out.push(p);
  }
  return out;
}

const metrics = {};
let sectors = null;

for (const file of walk(DATA)) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.metric_id) {
    metrics[data.metric_id] = data;
  } else if (data.section === 'sectors' && Array.isArray(data.sectors)) {
    sectors = data;
  }
}

const bundle = {
  generated_at: new Date().toISOString(),
  metric_count: Object.keys(metrics).length,
  metrics,
  sectors
};

writeFileSync(OUT, JSON.stringify(bundle), 'utf8');
console.log(`✓ bundled ${bundle.metric_count} metrics + ${sectors ? sectors.sectors.length : 0} sectors → app/dist/data.json (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`);
