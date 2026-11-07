(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('form'), urlIn = $('url'), goBtn = $('go'), errEl = $('error');
  const titleIn = $('title'), startIn = $('start'), speedSel = $('speed'), thumbIn = $('thumb');
  const loopCb = $('loop'), proxyCb = $('proxy');
  const result = $('result'), statusEl = $('status'), outLink = $('outLink'), copyOut = $('copyOut'), openOut = $('openOut');
  const historyBox = $('historyBox'), historyEl = $('history'), clearBtn = $('clearHistory');
  const toastEl = $('toast');

  /* ---------- id encoding (must match lib/shared.js) ---------- */
  function encodeId(href) {
    const scheme = href.startsWith('https://') ? 's' : 'h';
    const bytes = new TextEncoder().encode(href.replace(/^https?:\/\//, ''));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return scheme + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const PAGE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|twitch\.tv|dailymotion\.com|reddit\.com)$/i;

  const store = {
    get(k, d) { try { const x = localStorage.getItem('sd_' + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
    set(k, val) { try { localStorage.setItem('sd_' + k, JSON.stringify(val)); } catch { /* ignore */ } },
  };

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }
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

  function parseStart(s) {
    s = s.trim();
    if (!s) return 0;
    const parts = s.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const fmtDur = (s) => {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };

  /* ---------- playability probe (best effort) ---------- */
  function probe(url, ms = 9000) {
    return new Promise((resolve) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      let done = false;
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeAttribute('src');
        el.load();
        resolve(res);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), ms);
      el.onloadedmetadata = () => finish({ ok: true, w: el.videoWidth, h: el.videoHeight, d: el.duration });
      el.onerror = () => finish({ ok: false, reason: 'error' });
      el.src = url;
    });
  }

  function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }
  function setStatus(cls, text) { statusEl.className = 'status ' + cls; statusEl.textContent = text; }

  /* ---------- create ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;

    let u;
    try { u = new URL(urlIn.value.trim()); } catch { return showError('That doesn’t look like a valid link. Include https://'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return showError('Only http(s) links are supported.');
    if (PAGE_HOSTS.test(u.hostname)) {
      return showError('That’s a page link, not a direct video file. Paste a direct .mp4 / .webm / .m3u8 link instead. (Discord already embeds YouTube links by itself.)');
    }
    const start = parseStart(startIn.value);
    if (Number.isNaN(start)) return showError('Start time looks wrong. Use 90 or 1:30.');

    const isHls = /\.m3u8$/i.test(u.pathname);
    const skipProbe = isHls || /(^|\.)(dropbox\.com|drive\.google\.com)$/i.test(u.hostname) || (location.protocol === 'https:' && u.protocol === 'http:');

    goBtn.disabled = true;
    result.hidden = false;
    setStatus('wait', skipProbe ? 'Link created.' : 'Checking that the link plays…');

    // build the share link
    const params = new URLSearchParams();
    const title = titleIn.value.trim();
    if (title) params.set('n', title);
    if (start > 0) params.set('t', String(Math.floor(start)));
    if (speedSel.value) params.set('s', speedSel.value);
    if (loopCb.checked) params.set('l', '1');
    if (proxyCb.checked && !isHls) params.set('p', '1');
    const thumb = thumbIn.value.trim();
    if (thumb) { try { const t = new URL(thumb); if (t.protocol === 'https:') params.set('i', t.href); } catch { /* ignore */ } }

    const id = encodeId(u.href);
    const build = (extra) => {
      const p = new URLSearchParams(params);
      if (extra) for (const [k, val] of Object.entries(extra)) p.set(k, val);
      const qs = p.toString();
      return location.origin + '/v/' + id + (qs ? '?' + qs : '');
    };
    outLink.value = build();
    openOut.href = outLink.value;

    if (!skipProbe) {
      const r = await probe(u.href);
      if (r.ok) {
        const dims = r.w && r.h ? ` · ${r.w}×${r.h}` : '';
        setStatus('ok', `Playable in your browser${dims}${isFinite(r.d) ? ' · ' + fmtDur(r.d) : ''}`);
        if (r.w && r.h) { outLink.value = build({ d: r.w + 'x' + r.h }); openOut.href = outLink.value; }
      } else {
        setStatus('warn', 'Couldn’t verify this link from here. The host may block direct playback or use an unsupported format. The player will retry through this site’s proxy automatically.');
      }
    } else if (isHls) {
      setStatus('ok', 'HLS stream. It plays through the built-in HLS player (the host must allow CORS). Discord can’t embed HLS, so it shows a normal link preview.');
    }

    goBtn.disabled = false;
    saveHistory({ title: title || u.pathname.split('/').pop() || u.hostname, host: u.hostname, link: outLink.value, ts: Date.now() });
    renderHistory();
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  copyOut.addEventListener('click', async () => {
    outLink.select();
    toast((await copyText(outLink.value)) ? 'Link copied' : 'Press Ctrl+C to copy');
  });
  outLink.addEventListener('focus', () => outLink.select());

  /* ---------- history ---------- */
  function saveHistory(item) {
    const list = store.get('history', []).filter((x) => x.link !== item.link);
    list.unshift(item);
    store.set('history', list.slice(0, 8));
  }
  function renderHistory() {
    const list = store.get('history', []);
    historyEl.textContent = '';
    historyBox.hidden = list.length === 0;
    for (const item of list) {
      const li = document.createElement('li');
      const t = document.createElement('div');
      t.className = 't';
      const b = document.createElement('b');
      b.textContent = item.title;
      const s = document.createElement('span');
      s.textContent = item.host;
      t.append(b, s);
      const open = document.createElement('a');
      open.className = 'btn ghost mini';
      open.textContent = 'Open';
      open.href = item.link;
      open.target = '_blank';
      open.rel = 'noopener';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn ghost mini';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => toast((await copyText(item.link)) ? 'Link copied' : 'Press Ctrl+C to copy'));
      li.append(t, copy, open);
      historyEl.appendChild(li);
    }
  }
  clearBtn.addEventListener('click', () => { store.set('history', []); renderHistory(); });
  renderHistory();
})();
