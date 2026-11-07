// GET /stream/:id.mp4  ->  streams the source video through this domain.
// Used as a fallback (http sources, wrong content-type, hotlink blocks) and for
// Dropbox / Drive links. Supports Range requests so seeking works.
import { decodeId, parseTarget, classify, blockedHost, hostAllowed } from '../lib/shared.js';

export const config = { runtime: 'edge' };

const BASE_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-length,content-range,accept-ranges',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function fail(status, message) {
  return new Response(message, {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const OK_TYPES = /^(video\/|audio\/|application\/(octet-stream|mp4|x-matroska|ogg|vnd\.apple\.mpegurl|x-mpegurl)|binary\/octet-stream)/;

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: BASE_HEADERS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed');

  const url = new URL(request.url);
  let id = url.searchParams.get('id');
  if (!id) {
    const m = url.pathname.match(/^\/stream\/([^/]+)\/?$/);
    if (m) id = m[1];
  }
  if (!id) return fail(400, 'Missing id');
  id = id.replace(/\.(mp4|m4v|webm|mov)$/i, '');

  const decoded = decodeId(id);
  if (!decoded) return fail(400, 'Invalid id');
  const target = parseTarget(decoded);
  if (target.error) return fail(400, target.error);
  if (target.url.host === url.host) return fail(400, 'Loop detected');
  if (!hostAllowed(target.url.hostname)) return fail(403, 'Host not allowed on this instance');

  const headers = new Headers({
    accept: '*/*',
    'user-agent': 'Mozilla/5.0 (compatible; StreamDropProxy/1.0)',
  });
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) headers.set('range', range);

  let upstream;
  try {
    upstream = await fetch(target.url.href, {
      method: request.method,
      headers,
      redirect: 'follow',
    });
  } catch {
    return fail(502, 'Could not reach the source');
  }

  // Redirects may have landed somewhere we should not proxy.
  try {
    const finalUrl = new URL(upstream.url || target.url.href);
    if (blockedHost(finalUrl.hostname) || !hostAllowed(finalUrl.hostname)) {
      upstream.body?.cancel();
      return fail(403, 'Redirected to a blocked host');
    }
  } catch { /* keep going */ }

  if (upstream.status === 416) {
    upstream.body?.cancel();
    return new Response(null, {
      status: 416,
      headers: { ...BASE_HEADERS, 'content-range': upstream.headers.get('content-range') || '' },
    });
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    upstream.body?.cancel();
    return fail(502, `Source responded with HTTP ${upstream.status}`);
  }

  const ct = (upstream.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (!OK_TYPES.test(ct)) {
    upstream.body?.cancel();
    return fail(415, 'The source is not a direct video file');
  }

  const info = classify(target.url);
  const outType = ct.startsWith('video/') || ct.startsWith('audio/') ? ct : info.mime || 'video/mp4';

  const out = new Headers(BASE_HEADERS);
  out.set('content-type', outType);
  out.set('accept-ranges', 'bytes');
  out.set('content-disposition', 'inline');
  out.set('cache-control', 'public, max-age=3600');
  for (const h of ['content-length', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
