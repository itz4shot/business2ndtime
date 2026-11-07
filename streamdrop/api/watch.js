// GET /v/:id  ->  full HTML page: Discord/OpenGraph meta tags + the player.
import {
  SITE_NAME,
  EMBED_MIME,
  decodeId,
  parseTarget,
  classify,
  fileTitle,
  esc,
  jsonForScript,
} from '../lib/shared.js';

export const config = { runtime: 'edge' };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src * data:",
  "media-src * blob: data:",
  "connect-src *",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=0, must-revalidate',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': CSP,
};

const SPRITE = `
<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false">
  <symbol id="i-play" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></symbol>
  <symbol id="i-back" viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.2" font-size="6.6" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui,sans-serif">10</text></symbol>
  <symbol id="i-fwd" viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.2" font-size="6.6" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui,sans-serif">10</text></symbol>
  <symbol id="i-vol" viewBox="0 0 24 24"><path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.2 6a8.6 8.6 0 0 1 0 12"/></symbol>
  <symbol id="i-vol-off" viewBox="0 0 24 24"><path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></symbol>
  <symbol id="i-fs" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></symbol>
  <symbol id="i-fs-exit" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></symbol>
  <symbol id="i-pip" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 5h18v14H3z"/><path fill="currentColor" d="M12 11h7v5h-7z"/></symbol>
  <symbol id="i-share" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M9 9h11v11H9zM5 15V4h11"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
</svg>`;

function shell({ title, head = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/player.css">
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function errorPage(message, status) {
  const html = shell({
    title: `${SITE_NAME} · Link problem`,
    head: '<meta name="robots" content="noindex">',
    body: `<main class="center-msg">
  <h1>${esc(message)}</h1>
  <p>Paste a direct video link (.mp4, .webm, .mov or .m3u8) on the home page to create a new player link.</p>
  <a class="btn" href="/">Make a player link</a>
</main>`,
  });
  return new Response(html, { status, headers: { ...HTML_HEADERS, 'cache-control': 'no-store' } });
}

function num(v, min, max, fallback) {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default function handler(request) {
  const url = new URL(request.url);

  let id = url.searchParams.get('id');
  if (!id) {
    const m = url.pathname.match(/^\/v\/([^/]+)\/?$/);
    if (m) id = m[1];
  }

  const decoded = decodeId(id);
  if (!decoded) return errorPage('This player link is invalid', 400);
  const target = parseTarget(decoded);
  if (target.error) return errorPage(target.error, 400);

  const source = target.url;
  const info = classify(source);

  // ----- options from the share link -----
  const q = url.searchParams;
  const start = num(q.get('t'), 0, 360000, 0);
  const speedParam = q.get('s') ? num(q.get('s'), 0.25, 4, 1) : null;
  const loop = q.get('l') === '1';
  const forceProxy = q.get('p') === '1';
  const custom = (q.get('n') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  const title = custom || fileTitle(source) || `${SITE_NAME} video`;

  let dims = null;
  const d = /^(\d{2,5})x(\d{2,5})$/.exec(q.get('d') || '');
  if (d) dims = { w: Number(d[1]), h: Number(d[2]) };

  let thumb = '';
  try {
    const t = new URL(q.get('i') || '');
    if (t.protocol === 'https:') thumb = t.href;
  } catch { /* ignore */ }

  // ----- URLs -----
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const origin = isLocal ? url.origin : `https://${url.host}`;
  const proxyExt = EMBED_MIME[info.ext] ? info.ext : 'mp4';
  const proxyUrl = `${origin}/stream/${id}.${proxyExt}`;
  const rest = new URLSearchParams(url.search);
  rest.delete('id');
  const restStr = rest.toString();
  const query = restStr ? `?${restStr}` : '';
  const canonical = `${origin}/v/${id}${query}`;

  // Direct file URL for Discord / the player. HTTP sources, forced proxy and
  // rewritten (Dropbox/Drive) links go through our proxy.
  const direct = source.protocol === 'https:' && !target.rewritten && !forceProxy;
  const playSrc = info.hls ? source.href : direct ? source.href : proxyUrl;

  let embedUrl = '';
  let embedType = '';
  if (!info.hls) {
    if (direct && info.embeddable) {
      embedUrl = source.href;
      embedType = EMBED_MIME[info.ext];
    } else if (!info.ext || info.embeddable || target.rewritten || !direct) {
      embedUrl = proxyUrl;
      embedType = EMBED_MIME[info.ext] || 'video/mp4';
    }
  }
  const proxyIsHttps = proxyUrl.startsWith('https://');
  if (embedUrl === proxyUrl && !proxyIsHttps) embedUrl = ''; // Discord needs https

  const image = thumb || `${origin}/og.png`;

  // ----- <head> meta -----
  let meta = `
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#ffb224">`;

  if (embedUrl) {
    meta += `
<meta property="og:type" content="video.other">
<meta property="og:video" content="${esc(embedUrl)}">
<meta property="og:video:url" content="${esc(embedUrl)}">
<meta property="og:video:secure_url" content="${esc(embedUrl)}">
<meta property="og:video:type" content="${esc(embedType)}">
<meta name="twitter:card" content="player">
<meta name="twitter:player:stream" content="${esc(embedUrl)}">
<meta name="twitter:player:stream:content_type" content="${esc(embedType)}">`;
    if (dims) {
      meta += `
<meta property="og:video:width" content="${dims.w}">
<meta property="og:video:height" content="${dims.h}">
<meta name="twitter:player:width" content="${dims.w}">
<meta name="twitter:player:height" content="${dims.h}">`;
    }
  } else {
    meta += `
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">`;
  }

  const cfg = {
    src: playSrc,
    direct: direct ? source.href : null, // null => already proxied (or HLS)
    proxy: info.hls ? null : proxyUrl,
    hls: info.hls,
    title,
    start,
    speed: speedParam,
    loop,
    canonical,
    original: target.original.href,
  };

  const hostLabel = target.original.hostname.replace(/^www\./, '');

  const body = `${SPRITE}
<header class="topbar">
  <a class="brand" href="/"><span class="dot"></span>${esc(SITE_NAME)}</a>
  <a class="make" href="/">Make your own link</a>
</header>
<main class="wrap">
  <div class="player starting" id="player" tabindex="-1">
    <video id="v" playsinline webkit-playsinline preload="metadata"></video>
    <div class="surface" id="surface"></div>
    <div class="spinner" id="spinner" aria-hidden="true"></div>
    <div class="flash" id="flash" aria-live="polite"></div>
    <button class="bigplay" id="bigplay" type="button" aria-label="Play"><svg><use href="#i-play"/></svg></button>
    <button class="unmute" id="unmute" type="button" hidden><svg><use href="#i-vol-off"/></svg><span>Tap to unmute</span></button>
    <div class="err" id="err" hidden>
      <p id="errMsg"></p>
      <div class="err-actions">
        <button class="btn" id="retry" type="button">Try again</button>
        <a class="btn ghost" id="errOpen" href="${esc(target.original.href)}" target="_blank" rel="noopener noreferrer">Open original</a>
      </div>
    </div>
    <div class="menu" id="speedMenu" role="menu" aria-label="Playback speed" hidden></div>
    <div class="ui top"><span class="ttl">${esc(title)}</span></div>
    <div class="ui bottom">
      <input class="seek" id="seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
      <div class="row">
        <button class="ib" id="play" type="button" aria-label="Play"><svg><use href="#i-play"/></svg></button>
        <button class="ib" id="back" type="button" aria-label="Back 10 seconds"><svg><use href="#i-back"/></svg></button>
        <button class="ib" id="fwd" type="button" aria-label="Forward 10 seconds"><svg><use href="#i-fwd"/></svg></button>
        <span class="time"><span id="cur">0:00</span><span class="sep">/</span><span id="dur">0:00</span></span>
        <span class="grow"></span>
        <div class="vol">
          <button class="ib" id="mute" type="button" aria-label="Mute"><svg><use href="#i-vol"/></svg></button>
          <input class="volrange" id="vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
        </div>
        <div class="speedwrap">
          <button class="ib speedbtn" id="speed" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Playback speed">1×</button>
        </div>
        <button class="ib" id="pip" type="button" aria-label="Picture in picture" hidden><svg><use href="#i-pip"/></svg></button>
        <button class="ib" id="fs" type="button" aria-label="Fullscreen"><svg><use href="#i-fs"/></svg></button>
      </div>
    </div>
  </div>
  <section class="meta">
    <h1>${esc(title)}</h1>
    <p class="src">${esc(hostLabel)}</p>
    <div class="actions">
      <button class="btn" id="copy" type="button"><svg><use href="#i-copy"/></svg><span>Copy link</span></button>
      <button class="btn" id="share" type="button" hidden><svg><use href="#i-share"/></svg><span>Share</span></button>
      <a class="btn ghost" href="${esc(target.original.href)}" target="_blank" rel="noopener noreferrer"><svg><use href="#i-ext"/></svg><span>Open original</span></a>
    </div>
    <p class="hint hint-kbd">Shortcuts: <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> seek · <kbd>↑</kbd><kbd>↓</kbd> volume · <kbd>&lt;</kbd><kbd>&gt;</kbd> speed · <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute</p>
    <p class="hint hint-touch">Double-tap the left or right side to skip 10 seconds. Hold anywhere to play at 2×.</p>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script id="cfg" type="application/json">${jsonForScript(cfg)}</script>
<script src="/player.js" defer></script>
<noscript><p class="center-msg">JavaScript is required to play this video. <a href="${esc(target.original.href)}">Open the original file</a>.</p></noscript>`;

  return new Response(shell({ title: `${title} · ${SITE_NAME}`, head: meta, body }), {
    status: 200,
    headers: HTML_HEADERS,
  });
}
