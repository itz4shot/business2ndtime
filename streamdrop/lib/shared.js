// Shared helpers for the edge functions (api/watch.js, api/proxy.js).
// Pure functions, no Node-only APIs, so they run on Vercel Edge and in Node.

export const SITE_NAME =
  (typeof process !== 'undefined' && process.env && process.env.SITE_NAME) || 'StreamDrop';

// Container types Discord can embed inline (MP4, WebM, QuickTime).
export const EMBED_MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const PLAY_MIME = {
  ...EMBED_MIME,
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mkv: 'video/x-matroska',
  m3u8: 'application/vnd.apple.mpegurl',
};

/* ---------- id <-> url ---------- */
// id = 's' (https) | 'h' (http) + base64url(utf8(url without scheme))

export function encodeId(href) {
  const scheme = href.startsWith('https://') ? 's' : 'h';
  const rest = href.replace(/^https?:\/\//, '');
  const bytes = new TextEncoder().encode(rest);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return scheme + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeId(id) {
  if (typeof id !== 'string' || id.length < 2 || id.length > 6000) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const scheme = id[0] === 's' ? 'https://' : id[0] === 'h' ? 'http://' : null;
  if (!scheme) return null;
  try {
    let b64 = id.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return scheme + new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/* ---------- URL safety ---------- */

export function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h.endsWith('.home.arpa')
  ) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // single-label host

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = +v4[1];
    const b = +v4[2];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (h.includes(':')) {
    return h === '::' || h === '::1' || /^(fc|fd|fe[89ab])/.test(h) || h.startsWith('::ffff:');
  }
  return false;
}

// Only `npm run dev` sets this, so local test files on localhost can be used.
const devAllowPrivate = () =>
  typeof process !== 'undefined' && process.env && process.env.STREAMDROP_DEV_ALLOW_PRIVATE === '1';

export function blockedHost(host) {
  return isPrivateHost(host) && !devAllowPrivate();
}

// Dropbox / Google Drive share pages -> direct file URLs (best effort).
export function normalizeSource(u) {
  const host = u.hostname.toLowerCase();
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    const n = new URL(u.href);
    n.searchParams.delete('dl');
    n.searchParams.set('raw', '1');
    return n;
  }
  if (host === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([\w-]+)/);
    const id = m ? m[1] : u.searchParams.get('id');
    if (id && /^[\w-]+$/.test(id)) {
      return new URL('https://drive.google.com/uc?export=download&id=' + id);
    }
  }
  return u;
}

// Returns { url: URL, original: URL, rewritten: boolean } or { error }.
export function parseTarget(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { error: 'Invalid URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http(s) links are supported' };
  if (u.username || u.password) return { error: 'Links with credentials are not allowed' };
  if (blockedHost(u.hostname)) return { error: 'This host is not allowed' };
  const n = normalizeSource(u);
  if (blockedHost(n.hostname)) return { error: 'This host is not allowed' };
  return { url: n, original: u, rewritten: n.href !== u.href };
}

export function hostAllowed(hostname) {
  const list =
    (typeof process !== 'undefined' && process.env && process.env.ALLOWED_HOSTS) || '';
  const allow = list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allow.length) return true;
  const h = hostname.toLowerCase();
  return allow.some((a) => h === a || h.endsWith('.' + a));
}

export function classify(u) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(u.pathname);
  const ext = m ? m[1].toLowerCase() : '';
  return {
    ext,
    hls: ext === 'm3u8',
    mime: PLAY_MIME[ext] || '',
    embeddable: Boolean(EMBED_MIME[ext]),
  };
}

export function fileTitle(u) {
  try {
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const name = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
    return name.slice(0, 120);
  } catch {
    return '';
  }
}

/* ---------- escaping ---------- */

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON that is safe inside <script type="application/json">.
export function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
