// Manual override layer · highest-priority read in the ingest chain.
//
// Drop a JSON file at data/manual-overrides/{metric_id}.json with shape:
//   { value, as_of, source_url, source_name?, note?, expires_at? }
//
// Ingest will use this value instead of running the parser. Expires after
// `expires_at` (or 60 days from as_of if not specified) to prevent silent
// staleness. See data/manual-overrides/README.md for full docs.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERRIDES_DIR = join(__dirname, '..', '..', 'data', 'manual-overrides');

const DEFAULT_TTL_DAYS = 60;

/**
 * Look up a manual override for a metric. Returns null if none exists,
 * is expired, or is malformed. Returns a parser-shaped result if valid.
 */
export function lookupOverride(metric_id) {
  const file = join(OVERRIDES_DIR, `${metric_id}.json`);
  if (!existsSync(file)) return null;

  let payload;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `malformed JSON: ${e.message}`, file };
  }

  if (typeof payload.value !== 'number' || Number.isNaN(payload.value)) {
    return { error: 'missing or invalid `value` (must be number)', file };
  }
  if (!payload.as_of || typeof payload.as_of !== 'string') {
    return { error: 'missing `as_of` (must be ISO date string)', file };
  }
  if (!payload.source_url || typeof payload.source_url !== 'string') {
    return { error: 'missing `source_url`', file };
  }

  // Compute expiry. If `expires_at` is set, use that. Otherwise default to
  // as_of + DEFAULT_TTL_DAYS days.
  let expiresAt;
  if (payload.expires_at) {
    expiresAt = new Date(payload.expires_at);
  } else {
    const asOf = new Date(payload.as_of);
    expiresAt = new Date(asOf.getTime() + DEFAULT_TTL_DAYS * 24 * 3600 * 1000);
  }
  if (Number.isNaN(expiresAt.getTime())) {
    return { error: 'invalid `expires_at` date', file };
  }
  if (Date.now() > expiresAt.getTime()) {
    return { error: 'expired', file, expiresAt: expiresAt.toISOString() };
  }

  // Normalize as_of to ISO. Accept YYYY-MM-DD or full ISO.
  let asOfIso = payload.as_of;
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOfIso)) asOfIso = asOfIso + 'T00:00:00.000Z';

  return {
    ok: true,
    file,
    value: payload.value,
    as_of: asOfIso,
    source_url: payload.source_url,
    source_name: payload.source_name || 'manual override',
    note: payload.note || null,
    expires_at: expiresAt.toISOString(),
    parse_meta: {
      source: 'manual-override',
      file,
      source_url: payload.source_url,
      source_name: payload.source_name || null,
      note: payload.note || null
    },
    raw: `MANUAL OVERRIDE · ${payload.source_name || payload.source_url}`
  };
}

/** List all current overrides (used by audit/health surfaces). */
export function listOverrides() {
  if (!existsSync(OVERRIDES_DIR)) return [];
  const out = [];
  for (const name of readdirSync(OVERRIDES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const metric_id = name.slice(0, -5);
    const result = lookupOverride(metric_id);
    if (result) out.push({ metric_id, ...result });
  }
  return out;
}
