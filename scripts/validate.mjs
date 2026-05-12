#!/usr/bin/env node
// IRM metric validator — Phase 1
// No dependencies. Runs schema check + custom rules from IRM_Build_Spec §06.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT, 'schema', 'metric.schema.json');
const DATA_DIR = join(ROOT, 'data');
const STRICT = process.argv.includes('--strict');

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

const errors = [];
const warnings = [];

function fail(file, msg)  { errors.push({ file, msg }); }
function warn(file, msg) { warnings.push({ file, msg }); }

// ──────────────────────────────────────────────────────────────
// Schema validation (minimal Draft-07-ish — no deps)
// ──────────────────────────────────────────────────────────────
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkType(file, path, value, expected) {
  const t = typeOf(value);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(t)) fail(file, `${path}: expected ${allowed.join('|')}, got ${t}`);
}

function checkEnum(file, path, value, allowed) {
  if (!allowed.includes(value)) fail(file, `${path}: "${value}" not in [${allowed.join(', ')}]`);
}

function checkPattern(file, path, value, pattern) {
  if (typeof value === 'string' && !new RegExp(pattern).test(value)) {
    fail(file, `${path}: "${value}" does not match pattern ${pattern}`);
  }
}

function checkIso(file, path, value) {
  if (typeof value !== 'string' || isNaN(Date.parse(value))) {
    fail(file, `${path}: not a valid ISO 8601 date-time`);
  }
}

function validateSchema(file, schema, data) {
  // required
  for (const req of (schema.required || [])) {
    if (!(req in data)) { fail(file, `missing required field: ${req}`); continue; }
  }
  // additionalProperties
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(data)) {
      if (!(k in (schema.properties || {}))) fail(file, `unknown field: ${k}`);
    }
  }
  // properties
  for (const [k, propSchema] of Object.entries(schema.properties || {})) {
    if (!(k in data)) continue;
    const v = data[k];

    if (propSchema.type) checkType(file, k, v, propSchema.type);
    if (propSchema.enum && v !== null) checkEnum(file, k, v, propSchema.enum);
    if (propSchema.pattern && typeof v === 'string') checkPattern(file, k, v, propSchema.pattern);
    if (propSchema.format === 'date-time' && v) checkIso(file, k, v);
    if (propSchema.minLength && typeof v === 'string' && v.length < propSchema.minLength) {
      fail(file, `${k}: shorter than minLength ${propSchema.minLength}`);
    }
    if (propSchema.minItems && Array.isArray(v) && v.length < propSchema.minItems) {
      fail(file, `${k}: fewer than minItems ${propSchema.minItems}`);
    }

    if (propSchema.type === 'object' && v && typeof v === 'object') {
      validateSchema(file, propSchema, v);
    }
    if (propSchema.type === 'array' && propSchema.items && Array.isArray(v)) {
      for (const [i, item] of v.entries()) {
        if (propSchema.items.type === 'object') validateSchema(`${file}[${i}]`, propSchema.items, item);
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Custom rules — Gates 2 & 5 from IRM_Build_Spec §06
// ──────────────────────────────────────────────────────────────
function customRules(file, m) {
  // Gate 2 (revised 2026-05-06): a "verified" metric must have a real value
  // and an as_of timestamp. Trends (mom_pct / yoy_pct) are allowed to be null
  // when sanitize-trends.mjs legitimately nulls them (unit shifts, sign flips,
  // or insufficient history). The prior rule deadlocked CI: sanitize would
  // null suspicious trends, validate would then fail the file, and the
  // freshly-ingested value never got committed back to the repo.
  if (m.verification_state === 'verified') {
    if (m.value === null || m.value === undefined) {
      fail(file, `verified metric must have non-null value (Gate 2)`);
    }
    if (!m.as_of) {
      fail(file, `verified metric must have non-null as_of (Gate 2)`);
    }
  }

  // Gate 6 (Tier B · 2026-05-12): anomaly check vs sparkline.
  // If the current value is >4 sigma from the metric's own historical
  // distribution, WARN (don't block bundle). Catches silent corruption
  // that passed plausibility band but is statistically odd.
  if (typeof m.value === 'number' && Array.isArray(m.sparkline_12m) && m.sparkline_12m.length >= 5) {
    const nums = m.sparkline_12m.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (nums.length >= 5) {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
      const stddev = Math.sqrt(variance) || 1e-9;
      const z = Math.abs((m.value - mean) / stddev);
      if (z > 4) {
        warn(file, `value ${m.value} is ${z.toFixed(1)}σ from sparkline mean ${mean.toFixed(2)} ± ${stddev.toFixed(2)} (Gate 6: anomaly check)`);
      }
    }
  }

  // Gate 2: cross-check has at least 1 entry
  if (!Array.isArray(m.source_crosscheck) || m.source_crosscheck.length < 1) {
    fail(file, `source_crosscheck must have ≥ 1 entry (Gate 2)`);
  }

  // Gate 5: shock_eligible needs trigger_thresholds
  if (m.shock_eligible === true && (!Array.isArray(m.trigger_thresholds) || m.trigger_thresholds.length < 1)) {
    fail(file, `shock_eligible:true requires non-empty trigger_thresholds (Gate 5)`);
  }

  // Gate 5: derived metrics need formula
  const DERIVED_REQUIRES_FORMULA = new Set([
    'real_10y_yield',
    'absorption_ratio',
    'ind_us_10y_spread',
    'driver_sector_breadth',
    'driver_oil_physical',
    'driver_institutional_flows',
    'driver_india_macro',
    'driver_real_economy',
    'driver_freight',
    'india_risk_score',
    'institutional_flow_regime',
    'real_economy_state',
    'supply_chain_state'
  ]);
  if (DERIVED_REQUIRES_FORMULA.has(m.metric_id) && !m.formula) {
    fail(file, `derived metric "${m.metric_id}" must have formula (Gate 5)`);
  }

  // Gate 2 (warn): stale metric (placeholder check — can't determine cadence here without lookup)
  if (m.last_verified_at) {
    const ageHours = (Date.now() - Date.parse(m.last_verified_at)) / 36e5;
    if (ageHours > 720 && m.as_of_period === 'live') {
      warn(file, `last_verified_at is ${Math.floor(ageHours)}h old for a live metric`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Walk
// ──────────────────────────────────────────────────────────────
// Subdirs that contain non-metric JSON files validate should skip
const SKIP_DIRS = new Set(['snapshots', 'manual-overrides', 'self-heal-reports']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json') && name !== 'manifest.json' && !name.startsWith('sectors') && name !== 'parser-health.json') out.push(p);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const files = walk(DATA_DIR);

console.log(BOLD(`\nIRM validator — ${files.length} metric files\n`));

let passed = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  const before = errors.length;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    validateSchema(rel, schema, data);
    customRules(rel, data);
  } catch (e) {
    fail(rel, `parse error: ${e.message}`);
  }
  const after = errors.length;
  if (after === before) {
    passed++;
    console.log(`  ${GREEN('✓')} ${DIM(rel)}`);
  } else {
    console.log(`  ${RED('✗')} ${rel}`);
  }
}

console.log();
if (errors.length) {
  console.log(BOLD(RED(`${errors.length} errors:\n`)));
  for (const { file, msg } of errors) console.log(`  ${RED('•')} ${file} → ${msg}`);
}
if (warnings.length) {
  console.log(BOLD(YELLOW(`\n${warnings.length} warnings:\n`)));
  for (const { file, msg } of warnings) console.log(`  ${YELLOW('•')} ${file} → ${msg}`);
}

console.log();
console.log(BOLD(`Result: ${GREEN(passed + ' passed')}, ${errors.length ? RED(errors.length + ' failed') : '0 failed'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`));
console.log();

process.exit(errors.length && STRICT ? 1 : errors.length ? 1 : 0);
