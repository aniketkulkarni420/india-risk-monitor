#!/usr/bin/env node
// Tiny static file server for local preview · no deps.
// Serves IRM_Build/ root on http://localhost:8080
// Usage: npm run serve

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.csv':  'text/csv; charset=utf-8'
};

const server = createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/app/index.html';
  // Default to /app/index.html when path has no extension and isn't a known dir
  const filePath = join(ROOT, url);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      const idx = join(filePath, 'index.html');
      const content = readFileSync(idx);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(content);
    }
    const ext = extname(filePath);
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + url);
  }
});

server.listen(PORT, () => {
  console.log(`\n  IRM dev server\n  → http://localhost:${PORT}/\n  → http://localhost:${PORT}/app/storybook.html\n`);
});
