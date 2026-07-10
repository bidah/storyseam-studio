# DaVinci Resolve export — technical implementation plan

Add an **"Export for Resolve"** button to the Editor tab that downloads a ZIP
containing an **FCPXML 1.9 timeline** plus all referenced media, so a user can
unzip it anywhere and import the cut into DaVinci Resolve
(File → Import → Timeline → `project.fcpxml`) with media relinking automatically.

**Status: not implemented. This document is the full spec — implement exactly this.**

---

## 1. Why this shape

- The FCPXML file is only *references* — it contains zero media bytes, and
  Resolve resolves those references against the **local filesystem**. All media
  in this app lives in Cloudflare R2 behind Worker URLs (`/gen/…`,
  `/sound-media/…`), which Resolve cannot fetch. So a bare XML would import as
  an all-offline (red) timeline. The export must therefore be a ZIP bundling
  the XML **and** the media, with the XML referencing media by **relative path**
  (`./media/<file>`), so Resolve finds everything sitting next to the XML —
  and even if paths break, it relinks by filename.
- **FCPXML** (not EDL, not OTIO): EDL is single-video-track and loses the music
  bed + fades; FCPXML round-trips the entire timeline model of this app
  (hard cuts, multiple tracks, per-clip gain, linear audio fades) and Resolve
  imports it natively.
- The timeline model is deliberately simple — **no transitions, no titles, no
  effects, no source in-points** (clips only trim from the tail, media in-point
  is always frame 0). This makes the FCPXML generation a pure, small function.

## 2. Existing architecture (verified file references)

- **SPA**: Vite + React in `src/`. Backend: Cloudflare Worker (Hono) in
  `worker/`. Media in R2, keyed `media/<pid>/<kind>/<file>`
  (`worker/src/lib/media.js:17`).
- **Timeline model** (canonical doc comment): `src/editor/timeline.js:10-53`.
  Shape:

  ```js
  {
    fps: 24, width: 1280, height: 720,
    source?: { kind, v, file, at },       // which cut it was built from
    tracks: [
      { id, name, type: "video", items: [ { id, src, from, durationInFrames,
                                            sourceDurationInFrames?, name, bundle,
                                            volume?, muted?, disabled? } ] },
      { id, name, type: "audio", items: [ { id, src, from, durationInFrames,
                                            name, track?, volume?,
                                            fadeInFrames?, fadeOutFrames?,
                                            muted?, disabled? } ] },
    ],
  }
  ```

  - `from` / `durationInFrames` / `sourceDurationInFrames` /
    `fadeInFrames` / `fadeOutFrames` are **integer frames at fps 24**
    (`FPS = 24`, `src/editor/timeline.js:24`).
  - `src` is a root-relative URL: `/gen/<file>` for video clips,
    `/sound-media/<file>` for music (`worker/src/routes/timeline.js:81,106`).
  - `volume` is linear gain 0..2, 1 = unity
    (`worker/src/routes/timeline.js:147,166-168`). Music items default to a
    low bed gain (~0.08 ≈ −22 dB, `worker/src/routes/timeline.js:29`).
  - `muted` / `disabled` are booleans set by editor ops
    (`worker/src/routes/timeline.js:169-174`). The Remotion composition
    **skips disabled items entirely** and silences muted ones — the export
    must match that behavior.
  - The editor supports **multiple channels per type** (drag a clip to a new
    row spawns another `video`/`audio` track), so do NOT assume exactly one
    video + one music track. Items within a track are normally gapless
    (`repackTrack`, `worker/src/routes/timeline.js:135-141`) but arbitrary
    `from` moves mean gaps AND overlaps within a track are possible.
- **Saved timeline**: `db.editorTimeline` inside the per-project `selections`
  doc — read with `readDoc(env, pid, "selections", {})`
  (`worker/src/routes/timeline.js:35,219`). The editor autosaves the whole
  timeline via `POST /api/timeline` (`worker/src/routes/timeline.js:267-280`).
- **Project resolution middleware**: `worker/src/index.js:148-156` — the
  active project comes from the `x-project-id` header **or `?projectId=`
  query** (or falls back to the user's active project). The SPA patches
  `window.fetch` to inject the header (`src/lib/projectFetch.js:47-65`);
  media elements / EventSource use the query param. **An `<a download>` link
  cannot set headers, so the export URL must carry `?projectId=`** — use
  `getProjectId()` from `src/lib/projectFetch.js:21`.
- **src → R2 key mapping**: URL prefix → kind via `kindForPrefix`
  (`worker/src/lib/media.js:24-34`): `/gen/` → `gen`, `/sound-media/` →
  `sound-media`, `/media/` → `shots`, `/final/` → `final`, `/refs/` → `refs`,
  `/multishot-media/` → `multishot`. Then `mediaKey(pid, kind, file)` →
  `env.BUCKET.get(key)`.
- **Route registration point**: `worker/src/index.js:327-336` (add
  `registerExport(app)` alongside `registerRender(app)`).
- **Pattern to mirror for the endpoint**: `worker/src/routes/render.js`
  (`registerRender`) — reads `db.editorTimeline`, validates
  `Array.isArray(timeline.tracks)`, 400s with a friendly message if absent.
- **UI insertion point**: `src/components/Editor.jsx` — the `RenderPanel`
  ("Deliver" button + Sheet) starts at ~line 1229. Add the export button next
  to the Deliver button. Autosave clientId pattern: `CLIENT_ID` from
  `@/lib/clientId` (`Editor.jsx:39`, used at `Editor.jsx:704`).

### Known model gaps (accept these, do not fix here)

- Source fps of the generated clips is not stored; everything in the app is
  authored and rendered at **24 fps** — assume it.
- No per-clip source in-point: every clip plays its media from 0 and only
  trims the tail. FCPXML `start` (source in-point) is therefore always `0s`.
- No transitions/titles to represent.

## 3. Deliverables (files to create/modify)

| File | Change |
| --- | --- |
| `worker/src/lib/fcpxml.js` | NEW — pure function: timeline JSON → FCPXML string + media manifest |
| `worker/src/routes/export.js` | NEW — `registerExport(app)`: `GET /api/export/resolve` streaming ZIP endpoint |
| `worker/src/index.js` | import + call `registerExport(app)` next to `registerRender(app)` |
| `worker/package.json` | add dependency `fflate` (pure-JS, Workers-compatible, used for the streaming ZIP) |
| `src/components/Editor.jsx` | "Export for Resolve" button + small handler (save timeline, then trigger download) |
| `scripts/check-fcpxml.mjs` | NEW — dev-only sanity script: sample timeline → fcpxml, assert offsets/escaping (run with `node`) |

No changes to `src/editor/Composition.jsx`, the Remotion bundle, or
`render-fn/` — the export never renders anything.

## 4. FCPXML generation — `worker/src/lib/fcpxml.js`

### 4.1 API

```js
// timeline: the editor timeline JSON (see §2)
// opts: { projectName: string }
// returns { xml: string, media: [ { src, zipName } ] }
//   media = deduped list of every referenced item.src that made it into the
//   XML, with the flat filename used inside the zip's media/ folder.
export function timelineToFcpxml(timeline, opts) { ... }
```

Pure function, no I/O, no env — unit-testable with `node`.

### 4.2 Time representation

All times are rational seconds strings on a 24 fps base:

```js
const fps = timeline.fps || 24;
const rt = (frames) => `${frames}/${fps}s`;      // e.g. 240 frames → "240/24s"
```

`frameDuration` of the format: `` `100/${fps * 100}s` `` → `"100/2400s"`
(Apple's convention; `1/24s` is also legal but use the ×100 form).

### 4.3 Item filtering and lane layout

1. Drop items with `disabled === true` (matches the player/render).
2. Collect video tracks (`type === "video"`) and audio tracks
   (`type === "audio"`) **in timeline order**.
3. Use the **gap-backbone pattern**: the spine contains a single `<gap>`
   spanning the full timeline duration, and every clip is a *connected*
   `asset-clip` child of that gap with a `lane` attribute. This makes every
   `offset` an absolute timeline position — no FCPXML parent-relative offset
   math (the classic source of exporter bugs).
   - Video track *i* (0-based) → `lane={i + 1}`
   - Audio track *j* (0-based) → `lane={-(j + 1)}`
   - Timeline duration = `max(item.from + item.durationInFrames)` over all
     kept items (same logic as `timelineDuration`, `src/editor/timeline.js:32-41`);
     minimum 1 frame.
   - Cosmetic note: Resolve imports the gap as an (empty) bottom video track
     with the connected clips stacked above it. Acceptable; do not try to put
     the primary track directly on the spine (that requires parent-relative
     offset math and explicit gap filler elements — out of scope).
4. **Overlap guard**: within one lane, connected clips must not overlap. For
   each track, sort items by `from`; if item N+1 starts before item N ends,
   move item N+1 (and any further overlapping items) to a synthetic extra lane
   (next free positive lane for video / next free negative lane for audio).
   Log nothing; this is silent and rare.

### 4.4 Resources

- One `<format>`:

  ```xml
  <format id="r1" name="FFVideoFormat720p24" frameDuration="100/2400s"
          width="1280" height="720"/>
  ```

  Use `timeline.width`/`height` with 1280×720 fallbacks. The `name` attr is
  optional decoration; keep the `FFVideoFormat<h>p<fps>` shape when the values
  are standard, else omit `name`.
- One `<asset>` per **unique `src`** (dedupe with a Map). Asset duration =
  max `sourceDurationInFrames || durationInFrames` seen across all items
  sharing that src (an asset must be at least as long as its longest usage).

  ```xml
  <asset id="a1" name="MS-01.mp4" start="0s" duration="240/24s"
         hasVideo="1" hasAudio="1" format="r1">
    <media-rep kind="original-media" src="./media/MS-01.mp4"/>
  </asset>
  ```

  - Video srcs (`/gen/…` etc.): `hasVideo="1" hasAudio="1"` (generated clips
    carry baked-in audio).
  - Audio srcs (`/sound-media/…`): `hasVideo="0" hasAudio="1"
    audioSources="1" audioChannels="2" audioRate="48000"`.
  - `media-rep src` is the **relative path inside the zip**:
    `./media/<zipName>`.
- **zipName**: the basename of the src (URL-decoded). On a basename collision
  between two different srcs (e.g. same filename under `/gen/` and
  `/sound-media/`), disambiguate by prefixing the kind:
  `sound-media__<file>`. Keep a `src → zipName` map and return it as
  `media` (the endpoint uses it to build the zip).

### 4.5 Timeline body

```xml
<library>
  <event name="shot-studio">
    <project name="{escaped projectName}">
      <sequence format="r1" duration="{rt(total)}" tcStart="0s" tcFormat="NDF"
                audioLayout="stereo" audioRate="48k">
        <spine>
          <gap name="Timeline" offset="0s" start="0s" duration="{rt(total)}">
            <!-- one per kept item, video lanes positive, audio negative -->
            <asset-clip ref="a1" lane="1" offset="{rt(item.from)}"
                        name="{escaped item.name}" start="0s"
                        duration="{rt(item.durationInFrames)}"
                        format="r1" tcFormat="NDF">
              <!-- optional children, see below -->
            </asset-clip>
          </gap>
        </spine>
      </sequence>
    </project>
  </event>
</library>
```

Header/footer:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources> … </resources>
  <library> … </library>
</fcpxml>
```

### 4.6 Volume, mute, fades → `<adjust-volume>`

Emit an `<adjust-volume>` child on an `asset-clip` when the item has a
non-unity volume, is muted, or has fades; omit it entirely otherwise.

- Linear volume → dB: `dB = 20 * log10(volume)`; clamp to `[-96, +12]`;
  `volume <= 0` or `muted === true` → `-96` (silence). Round to 1 decimal.
- Fades (audio items only; `fadeInFrames` / `fadeOutFrames` are linear ramps —
  `src/editor/timeline.js:20-22`):

```xml
<adjust-volume amount="-22dB">
  <fadeIn type="linear" duration="{rt(fadeInFrames)}"/>
  <fadeOut type="linear" duration="{rt(fadeOutFrames)}"/>
</adjust-volume>
```

Only emit `fadeIn`/`fadeOut` when the frame count is > 0. `amount="0dB"` is
fine as the wrapper when only fades are present.

### 4.7 XML escaping

Escape `& < > " '` in every attribute value (names contain `·` and arbitrary
user text — UTF-8 is fine, but the five XML specials must be entity-escaped).
Single small helper, applied everywhere an interpolated value lands in the XML.

### 4.8 Project name

`opts.projectName`: derive in the endpoint from `timeline.source` when present
(`{kind} v{v}`, e.g. `"scored v7"` → `"shot-studio scored v7"`), else
`"shot-studio timeline"`.

## 5. Export endpoint — `worker/src/routes/export.js`

### 5.1 Route

```
GET /api/export/resolve            (project from ?projectId= / header / session)
```

`GET` (not POST) so a plain `<a href>` can trigger it and the browser streams
the ZIP straight to disk — no in-memory blob on either side. The UI saves the
live timeline first (§6), so reading the saved `db.editorTimeline` is
authoritative.

### 5.2 Handler flow

```js
import { readDoc } from "../lib/docs.js";
import { kindForPrefix, mediaKey } from "../lib/media.js";
import { timelineToFcpxml } from "../lib/fcpxml.js";
import { Zip, ZipPassThrough } from "fflate";

export function registerExport(app) {
  app.get("/api/export/resolve", async (c) => {
    const pid = c.get("projectId");
    const db = await readDoc(c.env, pid, "selections", {});
    const timeline = db.editorTimeline;
    if (!timeline || !Array.isArray(timeline.tracks)) {
      return c.json({ error: "No timeline to export — load a cut into the editor first" }, 400);
    }
    // 1. Generate XML + media manifest (pure).
    // 2. Resolve each manifest src → R2 key; HEAD-check existence up front,
    //    404 with a clear message listing any missing files.
    // 3. Stream a STORE-only zip: project.fcpxml, README.txt, media/*.
    // 4. Return it with Content-Disposition: attachment.
  });
}
```

Register in `worker/src/index.js` next to `registerRender(app)`
(line ~336), with the matching import at the top.

### 5.3 src → R2 key

For each manifest entry, split `src` as `/<prefix>/<file…>`:

```js
const m = /^\/([^/]+)\/(.+)$/.exec(src);
const kind = m && kindForPrefix(m[1]);          // worker/src/lib/media.js:24
if (!kind) → collect as missing
const key = mediaKey(pid, kind, decodeURIComponent(m[2]));
```

Before streaming, `await env.BUCKET.head(key)` for every entry (parallel with
`Promise.all`). If any are missing, respond
`400 { error: "Missing media: <names>" }` — do NOT emit a zip with holes.
(Keep the head results; `size` is handy for logging but not required — the
zip streams with data descriptors and needs no sizes upfront.)

### 5.4 Streaming ZIP with fflate

Use `Zip` + `ZipPassThrough` (STORE — media is already compressed; fflate
still computes the required CRC32). Pipe into the Response via a
`TransformStream` so nothing buffers:

```js
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const zip = new Zip((err, chunk, final) => {
  if (err) { writer.abort(err); return; }
  writer.write(chunk);
  if (final) writer.close();
});

const addText = (name, text) => {
  const f = new ZipPassThrough(name);
  zip.add(f);
  f.push(new TextEncoder().encode(text), true);
};

// Kick off async fill; MUST NOT be awaited before returning the Response.
const fill = (async () => {
  addText("project.fcpxml", xml);
  addText("README.txt", readme);
  for (const { key, zipName } of resolved) {        // SEQUENTIAL, one at a time
    const obj = await c.env.BUCKET.get(key);
    const f = new ZipPassThrough(`media/${zipName}`);
    zip.add(f);
    const reader = obj.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      f.push(value);
    }
    f.push(new Uint8Array(0), true);                // finalize entry
  }
  zip.end();
})();
c.executionCtx.waitUntil(fill.catch(() => {}));

return new Response(readable, {
  headers: {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${zipFilename}"`,
    "cache-control": "no-store",
  },
});
```

Implementation notes:

- Entries are added **sequentially** — a zip's central directory requires
  entries laid out one after another; do not interleave two `ZipPassThrough`
  pushes.
- `zipFilename`: `shot-studio-<slug>-resolve.zip` where slug comes from
  `timeline.source` (`scored-v7`) or `timeline`; sanitize with
  `[^a-zA-Z0-9._-] → _` (same pattern as `render.js:96`).
- No `Content-Length` (chunked streaming is fine for downloads).
- **fflate has no Zip64 support**: a total archive over ~4 GB (or any single
  file over 4 GB) produces a corrupt zip. Sum the HEAD sizes first; if
  `total > 3.8 GB`, return
  `400 { error: "Export too large for zip (…GB) — trim the timeline" }`.
  Current projects are far below this; it's a guard, not a feature.
- CPU: STORE means the only per-byte work is CRC32 — fine within Workers CPU
  limits for hundreds of MB. If a giant export ever hits the cap, bump
  `limits.cpu_ms` in `wrangler.jsonc` (do not do this preemptively).

### 5.5 README.txt content (verbatim)

```
Shot Studio → DaVinci Resolve export
====================================

1. Unzip this archive anywhere (keep project.fcpxml next to the media folder).
2. In DaVinci Resolve, open your project, then:
   File → Import → Timeline… → select project.fcpxml
3. Resolve links the clips via the relative paths in the XML. If any clip
   shows as offline (red), right-click it in the Media Pool →
   "Relink Selected Clips…" → point it at the media folder from this zip.

Notes
- The timeline is 24 fps, 1280×720. Set your Resolve project to match
  (or let Resolve create the timeline with these settings on import).
- Audio fades and clip volumes from the Shot Studio editor are carried over.
```

## 6. UI — `src/components/Editor.jsx`

Add next to the **Deliver** button inside `RenderPanel`'s sibling area
(~line 1229; both buttons end up rendered in the same toolbar — follow how
`RenderPanel` and `CutPicker` are composed into the header).

Behavior — one button, no sheet/dialog needed:

```jsx
const [exporting, setExporting] = useState(false);
const runExport = useCallback(async () => {
  setExporting(true);
  setError(null);
  try {
    // 1. Persist the LIVE timeline so the GET reads what the user sees
    //    (same body shape as the autosave at Editor.jsx:704).
    const res = await fetch("/api/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline: timelineRef.current, clientId: CLIENT_ID }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Save failed");
    dirtyRef.current = false;
    // 2. Navigate an anchor at the export URL — the browser streams the zip
    //    to disk. <a> can't send x-project-id, so pass ?projectId=.
    const pid = getProjectId();
    const a = document.createElement("a");
    a.href = `/api/export/resolve${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    setError(String(e.message || e));
  } finally {
    setExporting(false);
  }
}, []);
```

Button (CLAUDE.md conventions: shadcn `Button`, **lucide icon, never emoji**;
`FileDown` or `Clapperboard` is taken — use `FileDown`):

```jsx
<Button variant="outline" size="sm" onClick={runExport}
        disabled={!timeline || exporting}
        title="Download a DaVinci Resolve timeline (FCPXML + media zip)">
  {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
  Export for Resolve
</Button>
```

- Import `FileDown` from `lucide-react` and `getProjectId` from
  `@/lib/projectFetch`.
- Note: the endpoint returns 400 as JSON if the timeline is empty or media is
  missing; an anchor navigation on an error shows the raw JSON in a new
  context. Mitigation (do this): before triggering the anchor, do a cheap
  preflight `fetch("/api/export/resolve", { method: "HEAD" })`? — **No**:
  Hono GET handlers don't get HEAD for free and a full GET preflight would
  stream the zip twice. Instead keep it simple: the empty-timeline case is
  already prevented by `disabled={!timeline}`, and missing media is rare;
  accept the raw-JSON tab for that edge. Do not build a job/polling flow.

## 7. Edge cases checklist (must all be handled)

- [ ] `disabled` items excluded from XML **and** from the media manifest
      (a clip only referenced by disabled items must not be zipped).
- [ ] `muted` → `-96dB` adjust-volume; `volume` 0..2 → dB clamp `[-96, +12]`.
- [ ] `fadeInFrames + fadeOutFrames` may equal the clip length (editor clamps
      to ≤ length, `Editor.jsx:1108-1111`) — emit both, no special-casing.
- [ ] Same `src` used by multiple items → one `<asset>`, many `asset-clip`s.
- [ ] Basename collision across kinds → `kind__file` zipName (§4.4).
- [ ] Overlapping items in one track → synthetic extra lane (§4.3.4).
- [ ] Empty video track / empty audio track / timeline with zero kept items →
      if no items survive filtering, return
      `400 { error: "Timeline is empty — nothing to export" }`.
- [ ] Names with `& < > " '` and unicode (`·`) escape correctly.
- [ ] `sourceDurationInFrames` missing (older saved timelines) → fall back to
      `durationInFrames` for asset duration.
- [ ] URL-encoded characters in `src` filenames → `decodeURIComponent` before
      both the R2 key and the zipName.
- [ ] Missing media in R2 → 400 listing filenames, no partial zip.
- [ ] > 3.8 GB total → 400 with size message (no Zip64 in fflate).

## 8. Verification plan

1. **Pure-function check** — `scripts/check-fcpxml.mjs`: build a synthetic
   timeline (2 video tracks incl. an overlap, music with fades + bed gain,
   a muted clip, a disabled clip, `&`/`·` in names), run `timelineToFcpxml`,
   assert: disabled clip absent, offsets/durations render as `N/24s`,
   `adjust-volume amount="-22dB"` (for volume 0.08 → −21.9dB, assert
   ±0.2 dB), escaping applied, manifest deduped. Then, if `xmllint` exists on
   PATH: `xmllint --noout project.fcpxml` (well-formedness only; there is no
   local DTD).
2. **Local end-to-end** — `npx wrangler dev` in `worker/` (uses local R2
   bindings per the repo's dev setup), load a real project with a saved
   editor timeline, `curl -sD- -o out.zip "http://localhost:8787/api/export/resolve?projectId=<pid>"`,
   then `unzip -l out.zip` (expect `project.fcpxml`, `README.txt`,
   `media/*` matching the timeline's unique srcs) and `unzip -t out.zip`
   (CRC check — this catches zip-stream sequencing bugs).
3. **Resolve import** — unzip, import `project.fcpxml` into DaVinci Resolve
   (File → Import → Timeline). Verify: clip order and cut points match the
   editor, music bed present at low gain with fades, no offline media. If a
   DaVinci Resolve MCP/scripting environment is available, this can be
   automated (import via the scripting API and diff timeline item start/end
   frames against the source JSON); otherwise it is a manual user step —
   ask the user to confirm.
4. **UI** — in the running app, Editor tab with a loaded cut: click
   "Export for Resolve", confirm the browser downloads
   `shot-studio-<slug>-resolve.zip` and that a dirty (unsaved) drag done just
   before exporting is reflected in the XML (the save-then-download flow).

## 9. Explicitly out of scope

- OTIO / EDL / AAF outputs.
- Probing real source fps (`r_frame_rate`) — everything is 24 fps by
  construction; if that ever changes, extend the ffprobe batching in
  `worker/src/routes/cuts.js:99-130`.
- Source in-point trimming (model doesn't have it).
- Driving Resolve directly via its scripting API.
- A background-job + polling flow (the render pipeline's Daytona pattern) —
  streaming from the Worker is sufficient and much simpler here.
- Transitions, titles, color metadata.
