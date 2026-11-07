(() => {
  'use strict';

  let cfg;
  try { cfg = JSON.parse(document.getElementById('cfg').textContent); } catch { return; }

  const $ = (id) => document.getElementById(id);
  const root = $('player'), v = $('v'), surface = $('surface'), flashEl = $('flash');
  const bigplay = $('bigplay'), unmuteBtn = $('unmute'), errBox = $('err'), errMsg = $('errMsg'), retryBtn = $('retry');
  const seek = $('seek'), playBtn = $('play'), backBtn = $('back'), fwdBtn = $('fwd');
  const curEl = $('cur'), durEl = $('dur'), muteBtn = $('mute'), vol = $('vol');
  const speedBtn = $('speed'), speedMenu = $('speedMenu'), pipBtn = $('pip'), fsBtn = $('fs');
  const toastEl = $('toast'), copyBtn = $('copy'), shareBtn = $('share');

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

  /* ---------- tiny helpers ---------- */
  const store = {
    get(k, d) { try { const x = localStorage.getItem('sd_' + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
    set(k, val) { try { localStorage.setItem('sd_' + k, JSON.stringify(val)); } catch { /* private mode */ } },
  };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const setIcon = (btn, id) => { const u = btn.querySelector('use'); if (u) u.setAttribute('href', '#' + id); };
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  };
  const fmtRate = (r) => (Number.isInteger(r) ? r : String(r)) + '×';

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }
  function flash(msg, hold) {
    flashEl.textContent = msg;
    flashEl.classList.remove('show', 'hold');
    void flashEl.offsetWidth; // restart animation
    flashEl.classList.add(hold ? 'hold' : 'show');
  }

  /* ---------- source loading (direct, proxy fallback, HLS) ---------- */
  let usingProxy = !cfg.direct && !cfg.hls; // server already chose the proxy
  let hls = null;
  let resumeAt = cfg.start || 0;
  let wantAutoplay = true;
  let autoMuted = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function destroyHls() { if (hls) { try { hls.destroy(); } catch { /* noop */ } hls = null; } }

  async function loadSource(url) {
    destroyHls();
    root.classList.add('loading');
    errBox.hidden = true;
    root.classList.remove('has-error');
    if (cfg.hls) {
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
      try { await loadScript('/vendor/hls.min.js'); } catch { return fail('Could not load the HLS player.'); }
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ maxBufferLength: 30, enableWorker: true });
        hls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (data && data.fatal) fail('This stream can’t be played. The host must allow cross-origin (CORS) requests for HLS.');
        });
        hls.loadSource(url);
        hls.attachMedia(v);
      } else {
        fail('This browser can’t play HLS streams.');
      }
      return;
    }
    v.src = url;
  }

  function fail(message) {
    root.classList.remove('loading');
    root.classList.add('has-error');
    errMsg.textContent = message;
    errBox.hidden = false;
  }

  v.addEventListener('error', () => {
    if (!v.getAttribute('src')) return;
    if (v.error && v.error.code === 1) return; // aborted by us
    if (!usingProxy && !cfg.hls && cfg.proxy) {
      // Direct playback failed (blocked, http, wrong type): retry through our proxy once.
      usingProxy = true;
      resumeAt = v.currentTime || resumeAt;
      autoplayPending = !v.paused || autoplayPending;
      loadSource(cfg.proxy);
      return;
    }
    fail('This link can’t be played. Use a public, direct video file (MP4 / WebM) or an HLS .m3u8 stream.');
  });

  retryBtn.addEventListener('click', () => {
    resumeAt = v.currentTime || resumeAt;
    autoplayPending = true;
    loadSource(usingProxy || !cfg.direct ? (cfg.proxy || cfg.src) : cfg.direct);
  });

  /* ---------- volume ---------- */
  const volSupported = (() => {
    try { const old = v.volume; v.volume = 0.5; const ok = Math.abs(v.volume - 0.5) < 0.01; v.volume = old; return ok; }
    catch { return false; }
  })();
  if (!volSupported) root.classList.add('no-vol');

  function syncVol() {
    const off = v.muted || v.volume === 0;
    setIcon(muteBtn, off ? 'i-vol-off' : 'i-vol');
    muteBtn.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
    const level = v.muted ? 0 : v.volume;
    vol.value = level;
    vol.style.setProperty('--p', level * 100 + '%');
  }
  function setVolume(x, announce) {
    x = clamp(x, 0, 1);
    v.volume = x;
    v.muted = x === 0;
    autoMuted = false;
    unmuteBtn.hidden = true;
    store.set('vol', x > 0 ? x : store.get('vol', 1));
    store.set('muted', x === 0);
    if (announce) flash('Volume ' + Math.round(x * 100) + '%');
  }
  function toggleMute() {
    if (v.muted || v.volume === 0) {
      v.muted = false;
      if (v.volume === 0) v.volume = store.get('vol', 1) || 0.6;
      store.set('muted', false);
    } else {
      v.muted = true;
      store.set('muted', true);
    }
    autoMuted = false;
    unmuteBtn.hidden = true;
  }
  v.volume = clamp(Number(store.get('vol', 1)) || 1, 0, 1);
  v.muted = store.get('muted', false) === true;
  v.addEventListener('volumechange', syncVol);
  vol.addEventListener('input', () => setVolume(Number(vol.value)));
  muteBtn.addEventListener('click', toggleMute);
  unmuteBtn.addEventListener('click', () => {
    v.muted = false;
    if (v.volume === 0) v.volume = store.get('vol', 1) || 1;
    autoMuted = false;
    unmuteBtn.hidden = true;
    store.set('muted', false);
  });

  /* ---------- speed ---------- */
  function buildSpeedMenu() {
    speedMenu.textContent = '';
    for (const r of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.dataset.rate = String(r);
      b.textContent = fmtRate(r);
      b.addEventListener('click', () => { setSpeed(r); closeMenu(); });
      speedMenu.appendChild(b);
    }
  }
  function syncSpeed() {
    const r = v.playbackRate;
    speedBtn.textContent = fmtRate(Math.round(r * 100) / 100);
    for (const b of speedMenu.children) b.setAttribute('aria-checked', String(Number(b.dataset.rate) === r));
  }
  function setSpeed(r, silent) {
    r = clamp(r, 0.25, 4);
    v.defaultPlaybackRate = r;
    v.playbackRate = r;
    store.set('speed', r);
    syncSpeed();
    if (!silent) flash('Speed ' + fmtRate(r));
  }
  function stepSpeed(dir) {
    const cur = v.defaultPlaybackRate || v.playbackRate;
    let idx = -1;
    if (dir > 0) {
      idx = SPEEDS.findIndex((s) => s > cur + 0.001);
      if (idx === -1) idx = SPEEDS.length - 1;
    } else {
      for (let j = SPEEDS.length - 1; j >= 0; j--) if (SPEEDS[j] < cur - 0.001) { idx = j; break; }
      if (idx === -1) idx = 0;
    }
    setSpeed(SPEEDS[idx]);
  }
  function openMenu() {
    speedMenu.hidden = false;
    speedBtn.setAttribute('aria-expanded', 'true');
    root.classList.add('menu-open');
    const active = speedMenu.querySelector('[aria-checked="true"]');
    if (active) active.scrollIntoView({ block: 'center' });
  }
  function closeMenu() {
    speedMenu.hidden = true;
    speedBtn.setAttribute('aria-expanded', 'false');
    root.classList.remove('menu-open');
  }
  speedBtn.addEventListener('click', () => (speedMenu.hidden ? openMenu() : closeMenu()));
  document.addEventListener('pointerdown', (e) => {
    if (!speedMenu.hidden && !e.target.closest('.speedwrap, #speedMenu')) closeMenu();
  });
  buildSpeedMenu();
  const startRate = cfg.speed || Number(store.get('speed', 1)) || 1;
  v.defaultPlaybackRate = clamp(startRate, 0.25, 4);
  v.playbackRate = v.defaultPlaybackRate;
  v.addEventListener('ratechange', syncSpeed);
  syncSpeed();

  /* ---------- play / pause / seek ---------- */
  function togglePlay() {
    if (root.classList.contains('has-error')) return;
    if (v.paused || v.ended) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }
  function seekBy(sec) {
    if (!isFinite(v.duration)) return;
    v.currentTime = clamp(v.currentTime + sec, 0, v.duration);
    flash((sec > 0 ? '+' : '−') + Math.abs(sec) + 's');
    paint();
  }

  playBtn.addEventListener('click', togglePlay);
  bigplay.addEventListener('click', togglePlay);
  backBtn.addEventListener('click', () => seekBy(-10));
  fwdBtn.addEventListener('click', () => seekBy(10));

  let scrubbing = false;
  seek.addEventListener('input', () => {
    if (!isFinite(v.duration)) return;
    scrubbing = true;
    curEl.textContent = fmt((seek.value / 1000) * v.duration);
    seek.style.setProperty('--p', seek.value / 10 + '%');
  });
  seek.addEventListener('change', () => {
    if (isFinite(v.duration)) v.currentTime = (seek.value / 1000) * v.duration;
    scrubbing = false;
  });

  function bufferedEnd() {
    const b = v.buffered, t = v.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.25 && b.end(i) >= t) return b.end(i);
    return t;
  }
  function paint() {
    if (scrubbing) return;
    const d = v.duration;
    const ok = isFinite(d) && d > 0;
    const p = ok ? (v.currentTime / d) * 100 : 0;
    seek.value = ok ? (v.currentTime / d) * 1000 : 0;
    seek.style.setProperty('--p', p + '%');
    seek.style.setProperty('--b', (ok ? (bufferedEnd() / d) * 100 : 0) + '%');
    curEl.textContent = fmt(v.currentTime);
  }
  let raf = 0;
  function loop() { paint(); raf = v.paused ? 0 : requestAnimationFrame(loop); }

  v.addEventListener('play', () => { root.classList.remove('paused'); setIcon(playBtn, 'i-pause'); playBtn.setAttribute('aria-label', 'Pause'); if (!raf) raf = requestAnimationFrame(loop); wake(); });
  v.addEventListener('pause', () => { root.classList.add('paused'); setIcon(playBtn, 'i-play'); playBtn.setAttribute('aria-label', 'Play'); paint(); wake(); });
  v.addEventListener('ended', () => { root.classList.add('paused'); setIcon(playBtn, 'i-play'); wake(); });
  v.addEventListener('timeupdate', paint);
  v.addEventListener('progress', paint);
  v.addEventListener('seeked', paint);
  v.addEventListener('waiting', () => root.classList.add('loading'));
  for (const ev of ['canplay', 'playing', 'loadeddata']) v.addEventListener(ev, () => root.classList.remove('loading'));
  v.addEventListener('loadedmetadata', () => {
    durEl.textContent = fmt(v.duration);
    if (v.videoWidth && v.videoHeight) root.style.setProperty('--ar', String(v.videoWidth / v.videoHeight));
    if (resumeAt > 0 && isFinite(v.duration) && resumeAt < v.duration - 0.5) v.currentTime = resumeAt;
    resumeAt = 0;
    paint();
  });
  v.addEventListener('durationchange', () => { durEl.textContent = fmt(v.duration); });
  v.loop = !!cfg.loop;

  /* ---------- autoplay (falls back to muted) ---------- */
  async function tryAutoplay() {
    if (!wantAutoplay) { root.classList.remove('starting'); return; }
    try {
      await v.play();
    } catch {
      v.muted = true;
      autoMuted = true;
      try {
        await v.play();
        unmuteBtn.hidden = false;
      } catch {
        autoMuted = false;
        v.muted = store.get('muted', false) === true;
      }
    }
    root.classList.remove('starting');
    syncVol();
  }
  let autoplayPending = true;
  v.addEventListener('loadedmetadata', () => {
    if (!autoplayPending) return;
    autoplayPending = false;
    tryAutoplay();
  });
  v.addEventListener('volumechange', () => { if (!v.muted && autoMuted) { autoMuted = false; unmuteBtn.hidden = true; } });

  /* ---------- controls visibility ---------- */
  let idleTimer;
  function wake() {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (v.paused || root.classList.contains('menu-open') || root.querySelector('.ui:hover')) return;
      root.classList.add('idle');
    }, 2800);
  }
  root.addEventListener('pointermove', wake);
  root.addEventListener('keydown', wake);

  /* ---------- gestures ---------- */
  let wasIdle = false, holdTimer = 0, held = false, prevRate = 1, lastTap = 0, lastX = 0, tapTimer = 0;
  const frac = (e) => { const r = surface.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };

  function endHold() {
    clearTimeout(holdTimer);
    if (held) {
      held = false;
      v.playbackRate = prevRate;
      flashEl.classList.remove('hold');
    }
  }
  surface.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') root.classList.add('touch');
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    wasIdle = root.classList.contains('idle');
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (v.paused) return;
      held = true;
      prevRate = v.playbackRate;
      v.playbackRate = 2;
      flash('2× speed', true);
    }, 450);
  });
  surface.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (held) { endHold(); return; }
    clearTimeout(holdTimer);
    if (e.pointerType === 'mouse') { togglePlay(); return; } // dblclick handled below
    // touch / pen
    const now = Date.now();
    if (now - lastTap < 300 && Math.abs(e.clientX - lastX) < 70) {
      clearTimeout(tapTimer);
      lastTap = 0;
      const f = frac(e);
      if (f < 0.34) seekBy(-10);
      else if (f > 0.66) seekBy(10);
      else toggleFullscreen();
    } else {
      lastTap = now; lastX = e.clientX;
      tapTimer = setTimeout(() => { if (wasIdle) wake(); else togglePlay(); }, 280);
    }
  });
  surface.addEventListener('pointercancel', endHold);
  surface.addEventListener('pointerleave', endHold);
  surface.addEventListener('contextmenu', (e) => { if (e.pointerType === 'touch') e.preventDefault(); });
  surface.addEventListener('dblclick', (e) => {
    const f = frac(e);
    if (f < 0.34) seekBy(-10);
    else if (f > 0.66) seekBy(10);
    else toggleFullscreen();
  });

  /* ---------- fullscreen / PiP ---------- */
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function toggleFullscreen() {
    if (fsElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (root.requestFullscreen) {
      root.requestFullscreen().then(() => {
        try { if (screen.orientation && screen.orientation.lock && v.videoWidth > v.videoHeight) screen.orientation.lock('landscape').catch(() => {}); } catch { /* noop */ }
      }).catch(() => {});
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen(); // iPhone Safari: native player
    }
  }
  function onFsChange() {
    const on = fsElement() === root;
    root.classList.toggle('fs', on);
    setIcon(fsBtn, on ? 'i-fs-exit' : 'i-fs');
    if (!on) { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch { /* noop */ } }
    wake();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  fsBtn.addEventListener('click', toggleFullscreen);

  if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
    pipBtn.hidden = false;
    pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await v.requestPictureInPicture();
      } catch { /* not allowed */ }
    });
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const onButton = e.target && e.target.tagName === 'BUTTON';
    let handled = true;
    switch (k) {
      case ' ': case 'k': case 'K':
        if (onButton && k === ' ') { handled = false; break; }
        togglePlay(); break;
      case 'ArrowLeft': seekBy(-5); break;
      case 'ArrowRight': seekBy(5); break;
      case 'j': case 'J': seekBy(-10); break;
      case 'l': case 'L': seekBy(10); break;
      case 'ArrowUp': setVolume((v.muted ? 0 : v.volume) + 0.05, true); break;
      case 'ArrowDown': setVolume((v.muted ? 0 : v.volume) - 0.05, true); break;
      case 'm': case 'M': toggleMute(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case '>': case '.': stepSpeed(1); break;
      case '<': case ',': stepSpeed(-1); break;
      case 'Home': if (isFinite(v.duration)) v.currentTime = 0; break;
      case 'End': if (isFinite(v.duration)) v.currentTime = v.duration; break;
      case 'Escape': if (!speedMenu.hidden) closeMenu(); else handled = false; break;
      default:
        if (/^[0-9]$/.test(k) && isFinite(v.duration)) v.currentTime = (Number(k) / 10) * v.duration;
        else handled = false;
    }
    if (handled) { e.preventDefault(); wake(); }
  });

  /* ---------- share / copy ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sprite';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
  copyBtn.addEventListener('click', async () => toast((await copyText(cfg.canonical)) ? 'Link copied' : 'Press Ctrl+C to copy: ' + cfg.canonical));
  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => navigator.share({ title: cfg.title, url: cfg.canonical }).catch(() => {}));
  }

  // After a mouse/touch click on a control, give focus back to the page so Space/arrows
  // control playback (keyboard-triggered clicks have detail === 0 and keep focus).
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && e.detail > 0) b.blur();
  });

  /* ---------- go ---------- */
  setIcon(playBtn, 'i-play');
  root.classList.add('paused');
  syncVol();
  loadSource(cfg.src);
})();
