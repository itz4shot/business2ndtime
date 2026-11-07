// Local dev server that mimics vercel.json (rewrites + edge handlers).
// Usage: node dev-server.mjs   (PORT=3000 by default)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

process.env.STREAMDROP_DEV_ALLOW_PRIVATE = '1'; // dev only: allow localhost test files
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

const routes = [
  [/^\/v\/([^/]+)\/?$/, '/api/watch.js'],
  [/^\/stream\/([^/]+)\/?$/, '/api/proxy.js'],
];

// Re-import handlers when their source (or lib/) changes, so edits show up without a restart.
async function getHandler(file) {
  let stamp = 0;
  for (const f of [file, '/lib/shared.js']) {
    stamp = Math.max(stamp, fs.statSync(new URL('.' + f, import.meta.url)).mtimeMs);
  }
  const mod = await import(new URL('.' + file, import.meta.url).href + '?v=' + stamp);
  return mod.default;
}

const server = http.createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || 'localhost:' + PORT}`;
    const u = new URL(req.url, base);

    for (const [re, file] of routes) {
      const m = re.exec(u.pathname);
      if (!m) continue;
      u.searchParams.set('id', m[1]);
      const handler = await getHandler(file);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const response = await handler(new Request(u, { method: req.method, headers }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body || req.method === 'HEAD') return res.end();
      const stream = Readable.fromWeb(response.body);
      res.on('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }

    // static files from /public
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, () => console.log(`StreamDrop dev server: http://localhost:${PORT}`));
