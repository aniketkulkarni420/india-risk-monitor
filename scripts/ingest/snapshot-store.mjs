// HTML snapshot store · saves successful-fetch source bodies for replay/debug.
//
// Pattern: when a parser successfully extracts a value from a URL, call
// recordSnapshot(metric_id, url, body, extractedValue). The body is gzipped
// and written to data/snapshots/{metric_id}/YYYY-MM-DD.html.gz with a sidecar
// .json holding metadata.
//
// Why: when a parser breaks tomorrow, we can diff today's snapshot vs
// yesterday's to see exactly what HTML changed. The self-healing bot reads
// these to propose new regex/selectors.
//
// Storage: gzip keeps disk usage tiny (~5-20KB per snapshot). Retains last
// 14 snapshots per metric by default; older ones are auto-pruned.

import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_ROOT = join(__dirname, '..', '..', 'data', 'snapshots');

const KEEP_LAST_N = 14;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB cap; truncate larger pages

export function recordSnapshot(metric_id, url, body, extractedValue, parser_id) {
  if (!metric_id || !body) return { saved: false, reason: 'missing args' };

  const dir = join(SNAP_ROOT, metric_id);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  const dateKey = new Date().toISOString().slice(0, 10);
  const file = join(dir, `${dateKey}.html.gz`);
  const metaFile = join(dir, `${dateKey}.json`);

  // If already saved today, don't overwrite (keep first-of-day snapshot)
  if (existsSync(file)) return { saved: false, reason: 'already_today', file };

  try {
    const truncated = body.length > MAX_BODY_BYTES;
    const payload = truncated ? body.slice(0, MAX_BODY_BYTES) : body;
    const gz = gzipSync(Buffer.from(payload, 'utf8'));
    writeFileSync(file, gz);
    writeFileSync(metaFile, JSON.stringify({
      metric_id, url, parser_id: parser_id || null,
      captured_at: new Date().toISOString(),
      bytes_original: body.length,
      bytes_gzipped: gz.length,
      truncated,
      extracted_value: extractedValue
    }, null, 2));

    prune(dir);
    return { saved: true, file, bytes_gzipped: gz.length };
  } catch (e) {
    return { saved: false, reason: e.message };
  }
}

function prune(dir) {
  try {
    const entries = readdirSync(dir)
      .filter(f => f.endsWith('.html.gz'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first
    for (const old of entries.slice(KEEP_LAST_N)) {
      try { unlinkSync(join(dir, old.f)); } catch {}
      const meta = old.f.replace('.html.gz', '.json');
      try { unlinkSync(join(dir, meta)); } catch {}
    }
  } catch {}
}

export function listSnapshots(metric_id) {
  const dir = join(SNAP_ROOT, metric_id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.html.gz'))
    .map(f => f.replace('.html.gz', ''))
    .sort()
    .reverse();
}
