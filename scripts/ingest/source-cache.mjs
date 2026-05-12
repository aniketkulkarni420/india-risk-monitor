// Source content cache · resilience layer 4.
//
// If a primary fetch fails, fall back to the most recent cached copy in
// data/source-cache/{host}/{date}.html.gz. Combined with snapshot-store
// (which only saves on SUCCESSFUL extract), this cache saves the raw HTML
// of every URL we hit, regardless of extract success.
//
// Filled by:
//   - scripts/mirror-sources.mjs (daily cron via .github/workflows/mirror-sources.yml)
//   - parser-side opportunistic cache writes
//
// Read by:
//   - fetchSmart() when live fetch fails
//   - self-heal diff
//   - manual review

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = join(__dirname, '..', '..', 'data', 'source-cache');

const MAX_AGE_DAYS = 14;

function urlKey(url) {
  try {
    const u = new URL(url);
    // Host + first 2 path segments + 8-char hash of full URL
    const path = u.pathname.split('/').filter(Boolean).slice(0, 2).join('-');
    const h = createHash('sha1').update(url).digest('hex').slice(0, 8);
    return { host: u.host, key: `${path || 'root'}-${h}` };
  } catch {
    const h = createHash('sha1').update(url).digest('hex').slice(0, 8);
    return { host: 'unknown', key: h };
  }
}

/**
 * Write a fresh cache entry for url. Called opportunistically by parsers.
 */
export function writeCache(url, body) {
  if (!body || typeof body !== 'string') return { saved: false };
  try {
    const { host, key } = urlKey(url);
    const dir = join(CACHE_ROOT, host);
    mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, `${today}__${key}.html.gz`);
    writeFileSync(file, gzipSync(Buffer.from(body, 'utf8')));
    pruneHost(dir);
    return { saved: true, file };
  } catch (e) {
    return { saved: false, error: e.message };
  }
}

/**
 * Read the most recent cache entry for url. Returns null if none / expired.
 */
export function readLatestCache(url) {
  try {
    const { host, key } = urlKey(url);
    const dir = join(CACHE_ROOT, host);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter(f => f.endsWith(`__${key}.html.gz`))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return null;
    const ageDays = (Date.now() - files[0].mtime) / 86400000;
    if (ageDays > MAX_AGE_DAYS) return null;
    const buf = gunzipSync(readFileSync(join(dir, files[0].f)));
    return { body: buf.toString('utf8'), ageDays: +ageDays.toFixed(1), file: files[0].f };
  } catch {
    return null;
  }
}

function pruneHost(dir) {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f);
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      } catch {}
    }
  } catch {}
}
