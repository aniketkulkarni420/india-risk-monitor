#!/usr/bin/env node
// Generate static API endpoints from app/dist/data.json.
// Cloudflare Pages serves these as static JSON files at:
//   /api/v1/metrics
//   /api/v1/metrics/{id}
//   /api/v1/composites
//   /api/v1/composites/{id}
//   /api/v1/sectors
//   /api/v1/health
//
// Free · no server · CDN-cached globally.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUNDLE = join(ROOT, 'app', 'dist', 'data.json');
const API_ROOT = join(ROOT, 'app', 'dist', 'api', 'v1');

mkdirSync(API_ROOT, { recursive: true });
mkdirSync(join(API_ROOT, 'metrics'), { recursive: true });
mkdirSync(join(API_ROOT, 'composites'), { recursive: true });

const data = JSON.parse(readFileSync(BUNDLE, 'utf8'));

// CORS-friendly minimal JSON. Strip _composite_was internals.
function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (k.startsWith('_')) continue;
      out[k] = clean(obj[k]);
    }
    return out;
  }
  return obj;
}

// 1) /api/v1/metrics · index of all metric IDs + minimal fields
const metrics = data.metrics || {};
const composites = {};
const realMetrics = {};
const compositeIds = new Set(['driver_oil_physical', 'driver_freight', 'driver_institutional_flows', 'driver_india_macro', 'driver_real_economy', 'driver_sector_breadth', 'india_risk_score', 'institutional_flow_regime', 'real_economy_state', 'supply_chain_state']);

for (const [id, m] of Object.entries(metrics)) {
  if (compositeIds.has(id)) composites[id] = m;
  else realMetrics[id] = m;
}

writeFileSync(join(API_ROOT, 'metrics.json'), JSON.stringify({
  generated_at: data.generated_at,
  count: Object.keys(realMetrics).length,
  metrics: Object.fromEntries(Object.entries(realMetrics).map(([id, m]) => [id, {
    metric_id: id,
    display_name: m.display_name,
    section: m.section,
    value: m.value,
    unit: m.unit,
    as_of: m.as_of,
    status: m.status,
    mom_pct: m.mom_pct,
    yoy_pct: m.yoy_pct
  }]))
}, null, 2));

// 2) /api/v1/metrics/{id}.json · per-metric full data
for (const [id, m] of Object.entries(realMetrics)) {
  writeFileSync(join(API_ROOT, 'metrics', `${id}.json`), JSON.stringify(clean(m), null, 2));
}

// 3) /api/v1/composites.json + per-composite
writeFileSync(join(API_ROOT, 'composites.json'), JSON.stringify({
  generated_at: data.generated_at,
  count: Object.keys(composites).length,
  composites: Object.fromEntries(Object.entries(composites).map(([id, c]) => [id, {
    metric_id: id,
    display_name: c.display_name,
    value: c.value,
    formula: c.formula,
    feeder_freshness: c.feeder_freshness,
    freshness_state: c.freshness_state
  }]))
}, null, 2));

for (const [id, c] of Object.entries(composites)) {
  writeFileSync(join(API_ROOT, 'composites', `${id}.json`), JSON.stringify(clean(c), null, 2));
}

// 4) /api/v1/sectors.json
if (data.sectors) {
  writeFileSync(join(API_ROOT, 'sectors.json'), JSON.stringify(clean(data.sectors), null, 2));
}

// 5) /api/v1/health.json · parser health
if (data.parser_health) {
  writeFileSync(join(API_ROOT, 'health.json'), JSON.stringify({
    generated_at: data.parser_health.generated_at,
    summary: data.parser_health.summary,
    system_state: data.system_state
  }, null, 2));
}

// 6) /api/v1/index.json · API discovery
writeFileSync(join(API_ROOT, 'index.json'), JSON.stringify({
  service: 'India Risk Monitor API',
  version: 'v1',
  generated_at: data.generated_at,
  endpoints: {
    metrics_index: '/api/v1/metrics.json',
    metric_detail: '/api/v1/metrics/{metric_id}.json',
    composites_index: '/api/v1/composites.json',
    composite_detail: '/api/v1/composites/{composite_id}.json',
    sectors: '/api/v1/sectors.json',
    health: '/api/v1/health.json'
  },
  rate_limit: 'CDN-served · no hard limit · please be nice',
  docs: 'https://india-risk-monitor.pages.dev/api/'
}, null, 2));

console.log(`✓ API generated · ${Object.keys(realMetrics).length} metrics · ${Object.keys(composites).length} composites · ${data.sectors ? 'sectors.json ✓' : 'no sectors'}`);
