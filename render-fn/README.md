# shot-studio `render-fn`

A standalone Vercel project that renders the shot-studio editor's Remotion
**"Editor"** composition on a **Vercel Sandbox** and stores the result in
**Cloudflare R2**.

## Why this exists

The backend is migrating to a Cloudflare **Hono Worker**. Remotion's bundler
(`@remotion/bundler`, webpack) and the headless-Chrome render can't run on a
Worker. This function lives on Vercel — where a build produces the bundle — and
does the heavy lifting. The Worker just does:

```
POST https://<this-deployment>.vercel.app/api/render
  { timeline, codec, crf, scale, compositionId?, outputKey }
→ { ok, url, bytes }
```

It is a lift of `server/lib/remotion-render.js`'s `renderVercel()` +
`server/index.js`'s `/api/render` handler, with the local-disk write replaced by
an R2 upload.

## API

`POST /api/render` (JSON):

| field           | type                       | default    | notes |
|-----------------|----------------------------|------------|-------|
| `timeline`      | `{ tracks, fps, width, height }` | —    | **required.** `tracks` media `src`s **must be public absolute URLs** (see below). |
| `outputKey`     | string                     | —          | **required.** R2 object key for the mp4, e.g. `renders/ep1/editor-v3.mp4`. |
| `codec`         | `"h264"` \| `"h265"`       | `h264`     | |
| `crf`           | number (1–51)              | `18`       | |
| `scale`         | `0.5` \| `1` \| `2`        | `1`        | |
| `compositionId` | string                     | `"Editor"` | |

Response: `{ ok: true, url, bytes, blobUrl, backend: "vercel", storage: "r2" | "blob" }`
or `{ ok: false, error }`.

### The caller must absolutize media URLs

The render's headless Chrome runs on a **remote** sandbox and fetches the
timeline's media over the network. Root-relative srcs like `/gen/MS-01.mp4`
won't resolve there. Before POSTing, the Worker must rewrite every
`item.src` that starts with `/` to a public absolute URL (the R2/public origin),
exactly as `absolutizeTracks()` does in `server/index.js`. This function passes
`timeline.tracks` through **untouched**.

## Storage: R2 direct, with a Blob fallback

The detached render always stages the mp4 in **Vercel Blob**. Then:

- **If all five `R2_*` vars are set** → the mp4 is copied Blob → R2 under
  `outputKey` and the **R2 public URL** is returned (`storage: "r2"`).
- **If R2 is not configured here** → the **Vercel Blob URL** is returned
  (`storage: "blob"`) and the Worker is expected to copy it to R2 itself.

Direct R2 upload was chosen as the default because `outputKey` is part of the
request contract and it keeps the round-trip to one call. The R2 client is the
same `aws4fetch` `AwsClient` + endpoint shape used in `server/index.js`, so the
same credentials work in both places.

## The composition is vendored (not imported from `../src`)

`@remotion/bundler` bundles `remotion/RemotionRoot.jsx`. That entry point and its
two deps (`Composition.jsx`, `timeline.js`) are **copied** from
`../src/editor/` into `remotion/` by `npm run sync`. They can't be referenced at
`../src/editor` directly because Vercel only deploys files under this project.

These three files are self-contained — they import only `react` and `remotion`,
with **zero app-code coupling** — so a straight copy is a complete, correct
bundle. If the editor composition ever grows an import from elsewhere in
`src/`, that dependency must also be vendored (extend `FILES` in
`scripts/sync-composition.mjs`).

**Re-run `npm run sync` whenever the editor composition changes** (the `deploy`
script does this automatically). The vendored files carry a "VENDORED … do not
edit by hand" banner.

## Env vars

See `.env.example`. Summary:

- `BLOB_READ_WRITE_TOKEN` — **required**, Vercel Blob store token (render staging).
- `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` — Vercel Sandbox creds.
  Optional when running on Vercel (OIDC is used automatically); set for `vercel dev`.
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` /
  `R2_PUBLIC_BASE_URL` — optional; when all set, upload straight to R2.

## Deploy

```bash
cd shot-studio/render-fn
npm install
npx vercel link                 # once, to create/attach the Vercel project

# set env vars (repeat per var, choose environments when prompted)
npx vercel env add BLOB_READ_WRITE_TOKEN
npx vercel env add R2_ACCOUNT_ID
# … R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL

npm run sync                    # copy the latest composition from ../src/editor
npx vercel deploy --prod        # or: npm run deploy  (runs sync + deploy)
```

Local test: `npx vercel dev`, then POST to `http://localhost:3000/api/render`.

## Known blocker: function duration vs. render time

The handler polls `getRenderProgress` until the render finishes (up to a 30-min
guard). A serverless function **must stay alive** for that whole window, so:

- `vercel.json` sets `maxDuration: 800` (≈13 min). **This requires Vercel Fluid
  Compute** (Pro/Enterprise). On Hobby the ceiling is far lower (10–60 s) and
  long renders **will be killed** mid-poll — the render still completes and lands
  in Blob, but the response never returns.
- For renders longer than the function ceiling, split the flow into two calls:
  a `start` call that returns `{ sandboxId, cmdId }` immediately (don't poll),
  and a `status` call the Worker polls. Both must run here (only this project has
  `@remotion/vercel`); the current single-call design is the simpler correct
  option for renders that fit within `maxDuration`.

Cold starts also re-run `@remotion/bundler` (a few seconds); the bundle is
cached per warm lambda.
