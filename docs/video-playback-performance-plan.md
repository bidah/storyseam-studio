# Snappier video playback: caching + faststart + 720p preview proxies

Execution plan. All paths relative to `shot-studio/`.

## Context

The editor timeline plays full-resolution Higgsfield mp4s streamed byte-for-byte from R2 through the Worker. Three gaps make playback slower than online editors (CapCut/Descript/Frame.io):

1. **No caching**: `streamKey()` (`worker/src/lib/media.js:74-109`) sends **no `cache-control` on 206 range responses** (which is all `<video>` traffic) and only 1h on 200s — every scrub/replay re-reads R2 through the Worker. Note: Workers Cache API (`caches.default`) is a **no-op on workers.dev** (verified against CF docs), and there's no custom domain — so the win available today is the *browser* HTTP cache, which correct headers unlock.
2. **No faststart guarantee**: mp4s are stored as delivered; a trailing `moov` atom forces the browser to range-fetch the file tail before frame one. Stitch/score/render outputs lack `-movflags +faststart` (only trim has it).
3. **No proxies**: the timeline scrubs originals. Editors generate a ~720p low-bitrate proxy at ingest and preview *that*; originals only for stills/export. The Daytona ffmpeg pipeline (`worker/src/lib/ffmpeg.js` `runNative`, jobs in `worker/src/lib/jobs.js`) already exists to do this.

Preloading is already solved (Remotion `premountFor` 2s + `pauseWhenBuffering` in `src/editor/Composition.jsx`) — it just has too many bytes to buffer.

Verified facts that shape the design:

- Gen keys are immutable by construction (`_genN`, `_trimN`, `complete_cut_vN` — never overwritten). The only overwritable family is `media/<pid>/final/*` (`render.js` writes fixed `editor-render.mp4`).
- Media is same-origin (SPA served by the same Worker; Vite proxies in dev) — stills canvas stays untainted; nothing here changes origins.
- No gen-ingest hook exists (`episode.js:331` download is a TODO); bytes reach R2 only via `/ingest*`, `/upload`, and migration scripts → proxy generation hooks `/ingest*` + a lazy on-request fallback.
- **Pre-existing bug found**: `/stills/*` is missing from `run_worker_first` (`worker/wrangler.jsonc:40-44`) — production `/stills/*.png` requests fall into the SPA fallback and return HTML. Fixed in passing.

## Tier 1 — quick wins (deployable alone)

### Step 1: Cache-control policy in `streamKey()` — `worker/src/lib/media.js`

- Set `cache-control: public, max-age=31536000, immutable` on **both** the 206 branch (line 104, currently header-less) and the 200 branch (line 107).
- Exception: keys under `media/<pid>/final/` get `public, no-cache` (etag already set at line 94 → cheap 304 revalidation) so re-renders of `editor-render.mp4` aren't stuck.
- Add `if-none-match` → 304 handling (compare against `obj.httpEtag`).
- Keep `accept-ranges`, CORS `*`, etag as-is. `?v=` nonces keep working (URL-varying only).
- Leave a comment: if a custom domain is ever attached, add a `caches.default` block here (~15 lines) for edge caching.

### Step 2: `/files/*` gets Range support + same policy — `worker/src/index.js:278-288`

Replace the bespoke handler body with `streamKey(c.env, key, c.req.header("range"))` (already imported). Adds range support, fixes the incorrect blanket `immutable` on `/files/media/<pid>/final/...`, keeps ffmpeg-sandbox `curl` inputs working (plain GET → 200 full body).

### Step 3: `+faststart` on remaining ffmpeg outputs

- `worker/src/routes/cuts.js:513` stitch: add `-movflags +faststart` to **both** the `-c copy` and libx264-fallback commands.
- `cuts.js:~435` mixScore args array: add `"-movflags", "+faststart"`.
- `worker/src/routes/render.js:106-115` deliver script: after the Remotion render, remux `ffmpeg -y -i out.mp4 -c copy -movflags +faststart out_fs.mp4 && mv out_fs.mp4 out.mp4`.
- Existing files: do NOT remux lazily on the serving path — folded into the Step 8 backfill job (stream-copy remux back to same key, idempotent).

## Tier 2 — preview proxies

### Step 4: Proxy key convention + serving route with fallback

- Key: `media/<pid>/proxy/<kind>/<file>` — namespaced so `listMedia(pid, "gen")` never sees proxies. Add `proxyKey()` + a proxy listing helper to `worker/src/lib/media.js`.
- Route in `worker/src/index.js` next to the media route loop (~line 317): `GET /proxy/:prefix/*` (prefix ∈ gen, multishot-media, sound-media, mapped via existing `kindForPrefix`):
  - Proxy exists (`BUCKET.head`) → `streamKey` with immutable policy.
  - Else → stream the **original** with `cache-control: public, max-age=60` + `x-proxy: fallback` header, and `waitUntil(ensureProxy(...))` as lazy backfill. Direct stream, not 302.
- Config: add `"/proxy/*"` **and the missing `"/stills/*"`** to `run_worker_first` in `worker/wrangler.jsonc`; add `/proxy` (and `/stills`) to the `vite.config.js` dev proxy map.

### Step 5: `ensureProxy` — background generation (new `worker/src/lib/proxy.js`)

- Guards: only video extensions; skip if proxy exists; stampede lock = marker object `<proxyKey>.lock` skipped if <15 min old.
- Work: reuse `getSandbox` (`lib/ffmpeg.js`) + `createJob`/`startSandboxJob` (`lib/jobs.js`), script modeled on the stitch script (`cuts.js:507-516`): curl original from `$BASE/files/<key>`, then

  ```
  ffmpeg -y -i in.mp4 \
    -vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2" \
    -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
    -c:a aac -b:a 96k -movflags +faststart out.mp4
  ```

  then `upload_r2` to the proxy key (snippet from `lib/upload-snippet.js` handles >90MB).
- Call sites (all under `waitUntil`): `POST /ingest/*` and `/ingest-mpu/complete` (`index.js:234-244, 267-275`) when key matches `^media/([^/]+)/(gen|multishot)/[^/]+\.mp4$` (skip `final/` and `proxy/`); plus the Step 4 lazy fallback. Leave a comment at the `episode.js:331` TODO to call it there when implemented.
- Accepted limit: `waitUntil` ~30s cap could cut off a cold sandbox creation — the lock expires and the next `/proxy/*` request retries.

### Step 6: Editor previews proxies, originals for stills/export — `src/components/Editor.jsx`

- New shared helper `toPreviewSrc(src)` in `src/lib/` (`/gen/x` → `/proxy/gen/x`, `/multishot-media/x` → `/proxy/multishot-media/x`, else unchanged).
- Rewrite srcs **only in the `playerInputProps` memo** (~line 827) for video tracks. The `timeline` state, autosaved doc (`POST /api/timeline`), and Deliver render all keep original srcs → headless export untouched.
- Timeline-card thumbs (`getVideoThumb`, lines 127-173): pass `toPreviewSrc(src)`.
- **Stills stay full-res** — rework `grabStill` (lines 873-918): fix the video-element match (line 883) to compare against `toPreviewSrc(clip.src)`, then capture from the ORIGINAL via a new `captureStillFromSource(src, timeSec)` helper (offscreen muted video, seek to `clipTimeSec`, await `seeked`, reuse `captureStillPng`, ~15s timeout; on failure fall back to painted proxy frame with `meta.proxy = true`).
- Pool cards (lines 494-508): leave on originals — their `onLoadedMetadata` duration feeds drop lengths, and faststart + immutable caching makes `preload="metadata"` cheap.

### Step 7: Cuts page via proxy — `src/routes/cuts.jsx`

`CutVersionCard` (~line 233-237): `src = toPreviewSrc(gen.url) + "?v=" + bump`. The stitched cut is the app's largest file → biggest single UX win. Fresh stitches play immediately via the fallback (original, max-age=60) and silently upgrade once the proxy lands.

### Step 8: Backfill — one batched admin job

`POST /api/admin/media-optimize` (auth: signed-in user of the active project): list gen+multishot mp4s, diff against proxy listing, start ONE detached sandbox job that loops: curl original → `-c copy -movflags +faststart` remux back to original key → 720p proxy encode → `upload_r2` proxy key, `|| true` per file. Returns `{ jobId }` pollable at `/api/jobs/:id`. Invoke with curl; the lazy fallback remains the passive safety net.

### Step 9 (optional, last): audio proxies for waveforms

`getAudioPeaks` (Editor.jsx:181-219) fetches full music tracks. Extend `ensureProxy` for `sound-media`: `ffmpeg -vn -c:a aac -b:a 96k -movflags +faststart` → `proxy/sound-media/<file>.m4a`; point waveform fetch (and optionally `<Audio>` preview src) at it. Deliver render keeps originals. Skip if effort-constrained.

## Execution order

1 → 2 → 3 (Tier 1, deploy, immediate win) → 4 → 5 (server plumbing, harmless while unused) → 6 → 7 (client switch behind always-safe fallback) → 8 (backfill) → 9 (optional).

## Verification

- **Tier 1**: `curl -sI -H 'range: bytes=0-1023' <worker>/gen/<file>.mp4` → 206 + immutable cache-control; DevTools: second play served from disk cache. After a new stitch: `curl -r 0-2047 <cut url> | strings | grep -m1 moov` finds moov in head bytes; Cuts page shows first frame with only small head range requests.
- **Tier 2**: `/proxy/gen/<file>` first hit → `x-proxy: fallback` + original bytes; after job completes → 720p proxy, immutable. Editor Network tab shows `/proxy/...` for player, originals only for pool metadata. Grab a still → original resolution (1920×1080, not 1280×720). Run Deliver → sandbox pulls `/files/media/<pid>/gen/...` originals. `/stills/*.png` hard-reload returns PNG, not HTML.
- End-to-end: play across clip boundaries in the editor — premount now buffers ~1.5 Mbps proxies, no stall.

## Risks / flags

- Cache API was deliberately excluded because it is a no-op on workers.dev. **That constraint is gone** — the app now serves from the custom domain `storyseam.app` (`worker/wrangler.jsonc` `routes`), where `caches.default` is live. `streamKey` (`worker/src/lib/media.js`) is the place to revisit: range responses can now be edge-cached instead of re-reading R2 on every scrub.
- How new Higgsfield takes currently land in R2 is unclear (`episode.js:331` TODO) — those get proxies only via lazy fallback/backfill until that's implemented.
- Proxy duration can differ from original by ≲1 frame — all duration-authoritative surfaces (pool metadata, timeline doc, render) stay on originals.
- Media routes have no ownership check today (only `/api/*` is guarded); proxies match the existing exposure, no change.
