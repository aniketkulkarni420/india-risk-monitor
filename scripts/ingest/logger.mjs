// JSONL audit logger — one line per fetch attempt.
// File: logs/ingest-YYYY-MM-DD.jsonl

import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'logs');

mkdirSync(LOG_DIR, { recursive: true });

function todayFile() {
  const d = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `ingest-${d}.jsonl`);
}

export function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  appendFileSync(todayFile(), line + '\n', 'utf8');
}

export const info  = (event, data) => log('info',  event, data);
export const warn  = (event, data) => log('warn',  event, data);
export const error = (event, data) => log('error', event, data);
