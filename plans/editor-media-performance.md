# Editor media loading — diagnosis and plan

Measured 2026-08-04 against the deployed `shot-studio-uploads` worker, from a
client in Rio de Janeiro (Cloudflare GIG colo).

## TL;DR

The editor is **latency-bound, not bandwidth-bound.** A 720p proxy clip is ~1 MB
and transfers in about half a second — but waits ~600 ms before the first byte
arrives, and that wait is paid again on every request because nothing is cached
at the edge. Cloudflare Stream optimises the axis that is already fine (bytes)
and would fight the Remotion preview and render paths. The fix is to cut round
trips: get the Worker's auth middleware off the media path, turn on edge
caching, stop mounting full-res `<video>` elements in the asset browser, and
prefetch timeline clips into blob URLs that survive a route unmount.

## What was measured

| Request | Size | TTFB | Total |
|---|---|---|---|
| Static asset (no Worker in path) | small | ~300 ms | — |
| `/healthz` (Worker + both auth middlewares) | small | ~310–430 ms | — |
| Media 1-byte range (`/files/media/.../proxy/gen/MS-09_gen2.mp4`) | 1 byte | **~570–790 ms** | — |
| Proxy clip, full | **1,028,657 B** | ~550 ms | ~1.0–1.3 s |
| Original clip, full | **5,302,198 B** | ~570–860 ms | ~2.6–4.1 s |

Two facts fall out of this:

- **A 1-byte media request costs ~600–790 ms.** That is pure overhead — no
  meaningful transfer. Against a ~300 ms static-asset baseline from the same
  edge, roughly **300–500 ms per media request is Worker-attributable.**
- **`cf-cache-status` is absent on every media response.** There is no edge
  cache at all. Every byte of every scrub is an R2 origin read.

Transfer runs at ~1–2 MB/s, so for a 1 MB proxy clip the latency and the
transfer are about the same size. Halving the bitrate would buy ~250 ms;
removing the round trips buys ~500 ms and compounds across every request a
`<video>` element makes.

### Where the latency goes

`worker/src/index.js:124`, `:146` and `:179` are all `app.use("*")` — they run on
**every** request, including `/proxy/*`, `/gen/*` and `/media/*`, because
`run_worker_first` in `worker/wrangler.jsonc:70-86` lists every media prefix.

Each media request therefore performs:

1. `await c.get("auth").api.getSession(...)` — Better Auth session lookup
   (`index.js:150`)
2. `await getActiveProject(c.env, userId)` — D1 read (`index.js:183`)
3. `BUCKET.get(key)` — R2 origin read, uncached

D1 reports `served_by_region: ENAM`, `served_by_colo: EWR` — Newark. From Rio
that is a transcontinental round trip per query, twice, before R2 is touched.

**The `x-project-id` fast path cannot help media.** `src/lib/projectFetch.js:73`
sets that header, but only on `fetch()`. A `<video>`, `<img>` or `<audio>`
element cannot send custom headers, so step 2 always falls through to the D1
lookup for media. Media is also the one request class that mostly doesn't need
the answer — the ownership check at `index.js:205-212` already skips anything
not under `/api/`, so media is public-by-URL regardless.

The code already anticipates the cache half of this, at
`worker/src/lib/media.js:147-150`:

> NOTE: Workers Cache API (`caches.default`) is a no-op on workers.dev and there
> is no custom domain, so the win here is purely the *browser* HTTP cache.

## Three distinct problems

### A. Timeline playback — the per-request latency tax

`PREMOUNT_SECONDS = 2` (`src/editor/Composition.jsx:28`) gives each clip a 2 s
head start. At ~600 ms TTFB plus ~500 ms transfer per 1 MB proxy clip, that
budget is *just* met on a good connection and missed on a worse one — which is
exactly the "takes a while, sometimes stalls" symptom. `pauseWhenBuffering`
then converts the miss into a visible timeline stall.

### B. Asset browser — the worst offender, and the easiest fix

`src/components/Editor.jsx:844-858` renders **one real `<video>` per tile**:

```jsx
<video
  ref={mediaRef}
  src={item.src}                 // "/gen/<file>.mp4" — full-res, NOT toPreviewSrc()
  muted playsInline preload="metadata"
  onLoadedMetadata={(e) => { ...; v.currentTime = Math.min(0.1, (v.duration||1)/2); }}
/>
```

Four compounding costs:

1. **Full-res originals.** `PoolCard` is the only media surface in the editor
   that skips `toPreviewSrc` — the Player (`Editor.jsx:1640`), timeline thumbs
   (`:243`) and waveforms (`:282`) all use the proxy. 5.3 MB per tile instead of
   1.0 MB.
2. **No poster and no thumbnail.** The tile's picture comes from the video
   decoding its own first frame. There is no video-thumbnail endpoint anywhere;
   `/thumb/*` (`index.js:491-512`) covers images only.
3. **`preload="metadata"` plus a seek to 0.1 s** means at least two range
   requests per tile, each paying the ~600 ms tax.
4. **No virtualization, no lazy mount.** `MediaPool` (`Editor.jsx:1263-1279`)
   maps every asset into the DOM at once. 20 clips ≈ 106 MB of concurrent
   requests. The IntersectionObserver pattern already exists in the codebase at
   `src/components/AgentChat.jsx:1101-1121` — it just isn't applied here.

### C. Remount on return to the editor

`src/routes/editor.jsx` is 10 lines with **no `loader` and no `swr()` key** —
the only tab not on the SWR/`tabCache` path (compare `cuts.jsx:489`,
`episode.jsx:1883`, `shotlist.jsx:324`). React Router v7 unmounts the route on
tab switch, so returning is a full cold boot:

- render gates on `if (loading && !timeline) return <Spinner/>` (`Editor.jsx:3604`)
- four refetches fire (`Editor.jsx:1677`, `:1687`, `:1712`, `:1787`)
- `<Player>` is recreated (it lives inside the route subtree, `Editor.jsx:4109`
  — no KeepAlive, no portal), so every `<video>` is rebuilt cold

**And media mounts twice.** The Player first renders at frame 0 (premounting
that neighbourhood), then a `setTimeout(…, 0) → seekTo(f)` restores the saved
playhead (`Editor.jsx:1541-1548`), mounting a second neighbourhood. A resumed
session loads two sets of clips.

Two things worth ruling out, because they're the obvious suspects and both are
innocent: `reloadKey` does **not** bump on navigation (`RootLayout.jsx:205-218`),
and the editor never interpolates it into a media URL — unlike Episode/Shots/Cuts,
editor media srcs are nonce-free and fully cacheable. There are no `key` props
forcing a remount either.

There **is** a real cache hole, but elsewhere — `worker/src/index.js:534-543`:
when a clip's proxy hasn't been encoded yet, the Worker serves the **full-res
original with `max-age=60`**. On a freshly generated cut that is every clip, so
any remount more than a minute later re-downloads 5.3 MB per clip. Compounding
it, the pool and the Player fetch *different* URLs for the same clip (`/gen/`
vs `/proxy/gen/`) — two independent downloads each.

## Is Cloudflare Stream the answer?

**No — not for the edit surface.** Reasons, strongest first:

1. **It optimises the wrong axis.** Stream's value is adaptive bitrate: keeping
   a long linear watch from stalling as bandwidth fluctuates. Your bytes are
   already small (1 MB/clip) and already transfer fine. Your problem is ~600 ms
   of latency per request and zero caching. Stream would cut that TTFB — but
   only because it serves from a CDN with no Worker in the path, which is
   exactly what fixes 1 and 2 below achieve without a migration.

2. **ABR does not apply to 5-second clips.** An HLS segment is typically 4–6 s,
   so most clips are a single segment. The ladder never switches. You'd add a
   manifest round trip per clip to buy adaptation that never happens.

3. **It fights the preview player.** `src/editor/Composition.jsx:13-18` records a
   deliberate choice: the preview uses the native `<Video>` (an HTML `<video>`)
   because `@remotion/media`'s WebCodecs path stutters and repeats audio while
   scrubbing. HTML `<video>` doesn't play HLS outside Safari. Adopting Stream
   means either moving to `@remotion/media` — the path already rejected on
   quality grounds — or hand-wiring hls.js, which the Remotion `<Player>` cannot
   drive frame-accurately.

4. **It fights the render path.** `/api/render` uses `<OffthreadVideo>` against
   originals via `/files/...` (`render.js:83-90`). OffthreadVideo supports HLS
   only on Chrome ≥142, and exports should conform to originals anyway.

5. **Seeking gets worse, and seeking is what an editor does.** A faststart MP4
   plus a Range request seeks to an exact byte in one round trip — you already
   apply `+faststart` (`proxy.js:67-71`, `admin.js:26-80`). HLS seeks at segment
   boundaries through manifest and segment fetches.

6. **Cost and a second asset lifecycle.** $5 per 1,000 min stored, $1 per 1,000
   min delivered — on top of the R2 you keep regardless, because renders need
   originals. Every generated clip gets uploaded and tracked twice.

The general shape: **an editor is a random-access, low-latency,
cache-everything problem; a streaming CDN is a sequential, high-throughput,
adapt-to-bandwidth problem.** Different problems.

**Where Stream *is* right:** delivering the finished episode to viewers.
Long-form, linear, unknown bandwidth, many viewers — its exact shape. Worth
considering for sharing and final-cut playback. Just not for the timeline.

## What web editors actually do

The pattern is consistent across Descript, Kapwing, Clipchamp, Veed and Canva,
and matches desktop NLEs (Premiere, Resolve, Final Cut):

| Practice | Status here |
|---|---|
| Edit against low-bitrate **proxies**, conform to originals at export | Done — 720p CRF 28 (`proxy.js:67-71`), except in the asset browser |
| **Thumbnails/posters** in the browser, never live `<video>` | Missing for video (`Editor.jsx:844-858`) |
| Serve media from a **CDN**, no auth in the hot path | Missing — Worker + 2 D1 reads, no edge cache |
| **Prefetch** upcoming media into memory | Partial — `premountFor` 2 s only, no `prefetch()` |
| Keep the player **alive across navigation** | Missing — editor unmounts fully |

Three of the five boxes are unticked, and none of them is the one Cloudflare
Stream would tick.

## Status

**Shipped 2026-08-04** (deployed to `shot-studio-uploads`, version
`a15c7879-9991-4f4b-8098-598829023102`):

- `src/lib/mediaPrefetch.js` — new module-scoped blob registry (Tier 1 item 2)
- `PoolCard` now previews the proxy (Tier 1 item 1, interim form)
- `grabStill` matches prefetched blob urls (regression guard, see below)

Still open: posters/lazy-mount for the pool, `initialFrame`, and all of Tier 2.

**Custom domain update:** `worker/wrangler.jsonc` now sets
`WORKER_PUBLIC_URL = https://storyseam.app` and the deploy registers
`storyseam.app` as a custom domain, so the premise of the comment at
`worker/src/lib/media.js:147-150` ("there is no custom domain") is stale. The
zone is on Cloudflare nameservers but has **no A record yet**, so it doesn't
resolve and `workers.dev` is still the live origin. Once DNS is live, Tier 2
item 5 (`caches.default`) is unblocked — but it still needs Tier 2 item 4 first,
because the same media URL returns different bytes per project.

### A note on prefetch and `<video>` identity

Remotion's prefetch substitutes a blob url through **React context**
(`PreloadContext`), which `@remotion/player` provides internally — verified in
`node_modules/@remotion/player/dist/esm/index.mjs:3273`. So it does apply to the
deprecated `<Video>` this codebase deliberately uses, not just `@remotion/media`.

The consequence is that any code identifying a player `<video>` by its url must
account for the blob. `grabStill` did exactly that, and matching on the proxy
path alone would have fallen through to `painted[0]` — the wrong clip — and,
because the full-res capture branch is gated on `matched`, silently downgraded
every grabbed still to proxy quality. `prefetchedUrl(src)` exists for this.

## Plan

### Tier 1 — quick, high impact

**1. MediaPool: posters, not live video.** (fixes B)
Extend `ensureAssetThumbs` (`worker/src/lib/proxy.js:105+`) to emit a webp
poster per `/gen/` clip — the ffmpeg sandbox already does this for images.
Render `<img loading="lazy">` in the tile; mount a `<video>` only on
hover/click, and route it through `toPreviewSrc`. Add IntersectionObserver
gating using the pattern at `AgentChat.jsx:1101-1121`.
*Interim one-liner, worth shipping immediately:* wrap `item.src` in
`toPreviewSrc` at `Editor.jsx:847` — 5.3 MB → 1.0 MB per tile for a
one-word change.

**2. `prefetch()` + a module-level blob cache.** (fixes A, and most of C)
This is the web analogue of the mobile A/B double buffer, and it suits the web
better. Remotion's `prefetch(src)` downloads an asset to a blob URL, and
`<Video>`/`<Audio>`/`<Img>` transparently use the blob instead of the URL.
Because the registry lives at **module scope**, it survives the route unmount —
so returning to the editor rebinds `<video>` elements to blobs already in
memory, with no network at all.
At ~1 MB per proxy clip, a 40-clip episode is ~40 MB: prefetch the whole
timeline on editor open with a progress readout. That is the "instant"
experience, and it is what the 2 s `premountFor` is currently trying and
failing to do. Cap it with an LRU (~250 MB) and call `free()` on eviction.

**3. Seek before first paint.** (halves the media mounts in C)
Pass the restored playhead to `<Player initialFrame={...}>` instead of the
post-mount `seekTo` at `Editor.jsx:1541-1548`, so a resumed session premounts
one clip neighbourhood rather than two.

### Tier 2 — structural

**4. Take the auth middleware off the media path.** (~300–500 ms per request)
Media is already ungated; it just pays two Newark round trips for an answer it
barely uses. Make media URLs carry the project id so no `getActiveProject`
lookup is needed, and skip the session middleware for media prefixes.
`/files/*` already has this shape for the render sandbox. Prefer a new
`/p/:pid/proxy/:prefix/*` over pointing previews straight at `/files/`, so the
lazy `ensureProxy` fallback at `index.js:537` is preserved.

**5. Custom domain + `caches.default`.** (makes repeat loads edge-fast)
The TODO is already written at `media.js:147-150`: ~15 lines once a custom
domain exists. `Cache-Control` is already `immutable`, 1 year. This only works
*after* step 4, because today the same URL returns different bytes depending on
the `x-project-id` header — that header-dependence is what blocks edge caching.

**6. Put the editor on the SWR/tabCache path.** (fixes the rest of C)
Give `src/routes/editor.jsx` a `loader` calling `swr("editor", …)` like every
other tab, so `timeline`/`pool`/`stills` paint from the process-global store
instead of gating on `loading && !timeline`.

**7. Close the proxy-fallback cache hole.** (`index.js:534-543`)
Serving un-proxied clips as full-res originals at `max-age=60` means a fresh cut
re-downloads 5.3 MB per clip on every remount past a minute. Either block
briefly on `ensureProxy`, or serve the fallback with `stale-while-revalidate`
and a TTL keyed to the original's etag.

### Tier 3 — only if still not instant

**8. Lower the edit proxy to 480p CRF 30.** Halves bytes again (~500 KB/clip).
Editing quality is unaffected; the Grab Still path already re-reads the original
(`Editor.jsx:1735`) and flags proxy-sourced frames (`:1757`).

## Recommended order

Ship 1 and 2 first — together they address both complaints the user raised
(timeline clips and asset tiles) and most of the remount, without touching
infrastructure. Then 4 and 5, which are what actually make it *fast* rather than
*prefetched*, and which pay off for every surface in the app, not just the
editor.
