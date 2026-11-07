# StreamDrop

Paste a direct video link, get a shareable player page. Speed (0.25×–4×), volume, seek, fullscreen, PiP, phone and PC friendly. The shared link embeds inline in Discord.

No database, no build step, no accounts. The video URL is encoded inside the link itself.

## Deploy on Vercel

**Option A: GitHub (easiest from the dashboard)**
1. Put the contents of this folder in a new GitHub repo (the `api/`, `lib/`, `public/` folders and the root files must be at the repo root).
2. Vercel → Add New → Project → import the repo. Framework preset: **Other**. Leave build and install commands empty. Deploy.

**Option B: CLI**
```bash
cd streamdrop
npx vercel --prod
```

Optional: add a custom domain, so the Discord link looks clean.

### Environment variables (optional)
| Name | What it does |
|---|---|
| `SITE_NAME` | Brand name shown in the page and Discord embed (default `StreamDrop`). |
| `ALLOWED_HOSTS` | Comma-separated hostnames the `/stream/` proxy may fetch from, e.g. `cdn.example.com,files.mysite.com`. Strongly recommended if you only use your own hosts, because the proxy otherwise streams any public video URL through your Vercel bandwidth. |

## Share-link options

`https://your-site/v/<id>?n=Title&t=30&s=1.5&l=1&p=1&i=https://…/thumb.jpg&d=1280x720`

| Param | Meaning |
|---|---|
| `n` | Title (shown on the page and in the Discord embed) |
| `t` | Start time in seconds |
| `s` | Default speed (0.25–4) |
| `l` | `1` = loop |
| `p` | `1` = always stream through this site's proxy |
| `i` | Thumbnail image URL (https). Discord requires an image for the inline player; default is `/og.png` |
| `d` | Video size `WxH`, filled automatically by the home page |

The home page builds all of this for you.

## How Discord embedding works

Discord reads the `og:video` / `og:image` tags from the page. `api/watch.js` serves them. Discord only embeds **direct MP4 / WebM / MOV files over HTTPS** (no iframes), so:

- If the source is a direct https `.mp4/.webm/.mov`, Discord plays the **original file** (zero Vercel bandwidth).
- For `http://` sources, extensionless URLs, Dropbox or Drive links, or `p=1`, the embed uses this site's `/stream/` proxy instead.
- Inside Discord you get Discord's own player (play, volume, fullscreen). **Speed control is not available inside Discord's embed.** Click the link title to open the full player page.
- Discord caches embeds per URL. Changing options creates a new link; old messages keep their old preview.
- HLS (`.m3u8`) plays on the page (bundled hls.js; the host must send CORS headers) but Discord cannot embed it.
- Discord CDN attachment links expire after a while, so links made from them stop working then.

## Notes and limits

- Page links (YouTube, TikTok, Instagram, …) are not video files and are rejected. Discord already embeds YouTube natively.
- Google Drive links are converted to the download URL, which works for smaller files only (large files hit a Drive confirmation page).
- Proxy: Range requests are forwarded, so seeking works. Per Vercel's docs, an Edge function must start responding within 25 s and can stream for up to 300 s. Very long single transfers can be cut off.
- Private/internal hosts (localhost, 10.x, 192.168.x, …) are blocked in both the player and the proxy.
- Volume slider is hidden on iPhone because iOS does not allow web pages to change media volume (hardware buttons control it). iPhone fullscreen uses the native player.

## Local development

```bash
npm run dev        # http://localhost:3000, mimics vercel.json rewrites + the edge functions
```
Needs Node 18+. `npm run dev` also allows `localhost` video sources for testing; this is never enabled on Vercel.

## Files

```
api/watch.js    page + Discord/OpenGraph tags   (route: /v/:id)
api/proxy.js    Range-aware streaming proxy      (route: /stream/:id.mp4)
lib/shared.js   URL encode/decode, safety checks, escaping
public/         index.html, home.js, site.css, player.js, player.css, og.png, favicon.svg, vendor/hls.min.js
vercel.json     rewrites + headers
dev-server.mjs  local server
```
