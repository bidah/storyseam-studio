---
name: verify
description: Run shot-studio's real surfaces — a local Worker API and a headless Remotion render — to observe a change actually working. Use when verifying worker routes, the timeline model, or the Remotion compositions.
---

# Verifying shot-studio

Three surfaces. Pick the one the change reaches.

## 1. Worker API (routes, timeline model, docs) — the usual one

The Worker is the backend for everything. Run it locally with its own port and
its own project id so you never touch real data:

```bash
cd worker && npx wrangler dev --port 8788 --local   # local R2/D1/KV, starts empty
until curl -s -o /dev/null http://localhost:8788/api/shotlist; do sleep 1; done
```

**No login needed.** The ownership check in `worker/src/index.js` only fires when
a `userId` exists, so unauthenticated requests pass. Send an explicit project id
on every call and you get an isolated sandbox:

```bash
curl -s http://localhost:8788/api/animatic -H 'x-project-id: p_verify'
```

Local R2 starts empty, so **seed through the real routes** (not by writing docs):

- Shot list: `POST /api/shotlist` `{shots:[{id,beat,dur,location,camera,action,dialogue,prompt}]}` — the response's `packs` shows the derived MS-NN bundles.
- Stills: `POST /api/storyboard/image` `{bundle,shot,url,…}` — it **downloads the url**, so serve a real file: `cd /tmp && python3 -m http.server 8899` and pass `http://localhost:8899/x.png`.
- Sounds: `POST /api/sounds` `{kind:"voice",prompt}` → `POST /api/sounds/<id>/version/1/attach` `{url}` (a real .wav — the worker probes its true duration).
- Radio takes: `PUT /api/radio/take/sh<n>` `{trackId,v}` (line id is `sh<shot.n>`).

There is no episode-manifest writer, so a seeded project resolves bundles via the
`packPreview` fallback (`/api/animatic` reports `hasManifest:false`, `fromPacks:N`).

## 2. Remotion compositions (src/editor/*) — headless render

Don't eyeball the model; render a frame. This exercises the same composition as
the `<Player>` preview and the Deliver render. **Run the script from the repo
root** (`/tmp` can't resolve `@remotion/*`), and absolutize srcs the way
`worker/src/routes/render.js` does — `/storyboard-media/x.png` →
`http://localhost:8788/files/media/<pid>/storyboard/x.png`:

```js
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
const serveUrl = await bundle({ entryPoint: "src/editor/RemotionRoot.jsx", webpackOverride: (c) => c });
const inputProps = { tracks, fps, width, height };
const comp = await selectComposition({ serveUrl, id: "Editor", inputProps });
await renderStill({ composition: comp, serveUrl, output: "/tmp/f.png", frame: 60, inputProps });
```

First run downloads Chrome Headless Shell (~90 MB). Then `Read` the PNG.

## 3. The React UI — needs a session

`RootLayout` wraps everything in `LoginGate`, so `npm run dev` alone lands on a
login screen. For UI work, sign up a local user against the Worker's Better Auth
first. If the change is observable at the API or in a render, prefer those.

## Gotchas

- `node scripts/check-fcpxml.mjs` is the only automated check in the repo (pure assertions over the FCPXML builder). It's fast and worth running when touching `worker/src/lib/fcpxml.js` — but it is not a substitute for driving a surface.
- After editing `src/editor/*`, run `cd render-fn && npm run sync` — the Vercel render path uses a **vendored copy**.
- Timeline item media kind is per ITEM (`kind:"image"`), not per track. Images carry no `sourceDurationInFrames`/`offsetFrames`; `src:null` is a slate.
