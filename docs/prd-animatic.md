# PRD: Animatic (radio version + storyboard stills on the timeline)

**Status:** IMPLEMENTED (Phases 1–3) · this doc is now the design record, not a plan
**Surfaces touched:** timeline model, Remotion compositions (×3), Editor UI, Radio tab, Worker (animatic/timeline/storyboard/render/fcpxml), eve agent tools + skills

## What shipped vs. what this doc proposed

Read §1–§9 as the design; these are the places the implementation deliberately
diverged, plus what verification changed:

- **The slate is inserted SERVER-side, not locally** (§5.3 step 1 said "the UI
  inserts a slate locally via `mutate`"). Autosave is debounced 600 ms, and
  `replace` on a missing id is a tolerant no-op — so a local-only slate could
  still be absent server-side when the agent's `replace` lands, and the still
  would vanish with no error. The UI now calls `/api/timeline/edit` with a new
  **`insert`** op (stamped `CLIENT_ID` so its own broadcast doesn't bounce back),
  which makes `insert` a Phase-3 requirement rather than the optional extra §7
  called it.
- **The Editor does not build a `refBlock`** (§5.3). The bundle's picked
  references are Episode-tab state the Editor doesn't have; the turn tells the
  agent to resolve them with `get_episode` instead of handing it a guess.
- **"Add audio" is a real action**, not deferred: an Audio modal lists every
  *ready* Sound Studio version (the pool rail only shows each track's latest) and
  inserts at the clicked frame.
- **Drift detection**: see the risks table — it surfaces as `withStill` → 0, not
  as `unmatched`.
- **`shadcn` context-menu had no submenu primitives** — `ContextMenuSub`/
  `SubTrigger`/`SubContent` were added to `src/components/ui/context-menu.jsx`
  for "Swap take ›".
- **Found by verification, fixed:** still filenames used a `Date.now()`
  uniquifier, which collides within a millisecond — parallel attaches overwrote
  each other's R2 object and several takes pointed at one image. Now
  `crypto.randomUUID()`. This bug was *created* by making concurrent attaches
  viable (the `updateDoc` fix), so it had no prior symptom.
- **Version numbering** had to move from `list.length + 1` to `max(v) + 1` before
  retention could be capped — pruning would otherwise recycle version numbers.

Verification recipe (local Worker + headless Remotion render):
`.claude/skills/verify/SKILL.md`.

---

## 1. Overview

The **radio version** is the audio-only pass of the episode: every dialogue line
voiced and laid end-to-end on a timeline (`POST /api/radio/to-editor`). The
**storyboard** is the still-image pass: one generated still per shot, with takes
(`db.stills[bundle][shot]`). Today they never meet — the radio timeline ships with
a deliberately **empty video track** (`worker/src/routes/radio.js:190`).

An **animatic** is those two joined: the radio version rolling in the Editor with
each shot's still on the picture track, so the episode can be watched — timed,
voiced, and framed — before a single video clip is rendered.

This PRD covers three things, in dependency order:

1. **Image items on the timeline** — the model/preview/render can't show a still at all today. This is the keystone; everything else is downstream.
2. **The animatic build** — a new "Build animatic" action that joins radio takes to stills and lands a picture+dialogue timeline in the Editor.
3. **Right-click authoring in the Editor** — "Add scene" / "Add audio" on empty lane space, and "New still…" on an existing item, which opens a modal preloaded with that item's shot context (references, prompt, takes) and lands the new generation back on the timeline in place.

### Naming

"Still" is **overloaded in this repo** and the collision is load-bearing:

| term | what it is | where |
|---|---|---|
| **storyboard still** | generated keyframe per shot, has takes | `db.stills[bundle][shot]`, `/storyboard-media/`, Episode tab Images mode |
| **grabbed still** | a frame captured out of the Editor preview | `state/<pid>/stills.json`, `/stills/`, Editor pool Stills tab |

This feature is about **storyboard stills**. UI copy in the Editor should say
**"scene"** (the user-facing word for a shot's picture) and keep "Grab still" for
the existing capture action. Where this doc says "still" unqualified, it means
storyboard still.

### Goals

1. A timeline can contain image items that play in the `<Player>` preview and both headless render paths.
2. One action on the Radio tab builds an animatic covering **every shot** (not just voiced ones) and opens it in the Editor.
3. A shot with no still yet gets a visible **slate** placeholder, so a half-generated animatic reads as intentional and the holes are obvious and fillable.
4. Right-click on the timeline → generate a still for that slot, prefilled with the correct shot context, landing **in place** when it's done.
5. Stills carry enough provenance that "regenerate with edits" reproduces what the image was actually made from.

### Non-goals

- No Ken Burns / pan-zoom on stills (`offsetFrames` is not repurposed for it; see §3).
- No video generation from the Editor — the still→video upgrade path is Phase 4 groundwork only.
- No new Animatic **tab**. The animatic is a *build target* of the Radio tab and a *version* in the Editor's picker, exactly as radio versions are. There is no browsable data that Radio + Episode don't already show.
- No re-packing of bundles, no manifest writer (§4 leans on the existing manifest; fixing its staleness is out of scope but flagged in §11).

---

## 2. Current state (verified)

- **Timeline model** (`src/editor/timeline.js`, FPS 24): `{ fps, width, height, source, tracks:[{ id, type:"video"|"audio", items }] }`. Items carry `{ id, src, from, durationInFrames, offsetFrames?, sourceDurationInFrames?, name, bundle?, volume, muted?, disabled?, linkId?, flipH?, flipV?, fadeInFrames?, fadeOutFrames?, track? }`. **There is no `type`/`kind` field on an item** — media kind is derived purely from `track.type`.
- **Images are unsupported end-to-end.** `Composition.jsx:104-113` is a strict binary (`track.type === "audio" ? <AudioItem> : <VideoItem>`); no `<Img>` anywhere in `src/editor`, `render-fn/`, or `worker/src/routes/render.js`. `makeTrack` (`Editor.jsx:432`) only makes video/music tracks; `/api/pool` only emits `mediaType: "video"|"audio"`; `addPoolClip` (`:1804`) coerces everything to video-or-audio. `StillCard` (`:659`) is a plain button with **no drag handler** — grabbed stills cannot reach the timeline today.
- **Radio** (`worker/src/routes/radio.js`): structure is derived, never stored. `buildRadioView` reads `shotlist` + `radio` + `world` + `sounds` docs; `deriveLine` (`:42`) yields **one line per shot, and `null` for a shot with no dialogue** — silent shots produce nothing. Line id is `sh<shot.n>` (global 1-based index), and the line exposes `shotId: shot.id`. `buildRadioTimeline` (`:162`) lays ready takes gapless on a `dialogue` track + an **empty `video` track**, and appends to `db.radioVersions` with the whole timeline stored inline.
- **Stills** (`worker/src/routes/storyboard.js`): `db.stills[bundleId][shotId] = [{ file, name, angle, jobId, source, ts, selected?, selectedAt? }]` in the shared `selections` doc; bytes at `media/<pid>/storyboard/`, served `/storyboard-media/<file>`. **The prompt, model, and reference images are never persisted** — the agent composes the prompt in-turn (`agent/skills/generate-storyboard/SKILL.md:58-66`) and `attach_still` has no field for it. Writes use plain `readDoc`→`writeDoc` (last-writer-wins), unlike radio's `updateDoc`.
- **The shot↔still join exists and works, one-way** (verified): `GET /api/shotlist` **auto-seeds the shotlist by flattening the manifest** (`worker/src/routes/shotlist.js:18-31`), carrying `s.id` through `normalizeShot`. So shotlist `shot.id` === manifest `bundle.shots[].id` === the `db.stills` shot key. A shot has **no `bundle` back-reference**; the bundle must be resolved by scanning `manifest.bundles[].shots[].id` (authoritative — stills were keyed from it) or by `packPreview` (`worker/src/lib/pack.js:146`, positional `MS-01…`, served on every `GET /api/shotlist`, and **may disagree with the manifest** once the shotlist is edited). Both clients already do the packPreview join (`src/routes/shotlist.jsx:87`). **No code anywhere joins a shot to a still** — the Episode tab only ever reaches stills from the manifest side.
- **Editor**: `Editor.jsx` is 3130 lines and owns everything. Context menus already exist (shadcn `ContextMenu`) on **clips** (`:565` — Split/Disable/Detach/Link/Remove) and on the **player preview** (`:2675` — Grab still/Flip). There is **no menu on lanes, empty space, or gaps**. Lanes are `[data-lane]`/`[data-laneType]` divs. Clip pointerdown already ignores non-left buttons (`:480`), so a right-click never starts a drag.
- **Persistence**: `db.editorTimeline` in the `selections` doc; UI autosaves wholesale (`POST /api/timeline`, 600 ms debounce, stamped `CLIENT_ID`); the agent edits granularly via `POST /api/timeline/edit` → `applyTimelineOps` (`worker/src/routes/timeline.js:183`): `move, resize(edge), split, remove, volume, mute, disable, reorder, repack`. Live-sync: foreign edits (agent sends no clientId) trigger a silent reload.
- **Render paths (three copies must agree):** `src/editor/Composition.jsx` (preview), `render-fn/remotion/Composition.jsx` (**currently in sync** — `diff` shows only the vendored header; regenerate with `npm run sync`), and the Daytona bundle via `worker/build-remotion-bundle.sh` (**exists now**, unlike when the split PRD was written).
- **Remotion 4.0.486**: `<Img>` is exported from `remotion` and manages its own `delayRender` on load — the correct element for stills in both preview and render.
- The split PRD (`docs/prd-editor-cut.md`) shipped: `offsetFrames`, `split`, `resize edge:"start"`, and the FCPXML in-point mapping are all live. This doc follows its conventions.

---

## 3. Data model — `kind: "image"` (the keystone)

Add one optional field to picture-track items:

```js
kind?: "video" | "image"   // absent ⇒ "video" (every existing doc)
```

**Media kind moves from the track to the item.** Track type stays `"video"|"audio"`
(the *lane* semantic: picture vs sound), but what an item *is* becomes the item's
own business.

**Why not a third track type (`type: "image"`)?** Because the animatic's entire
reason to exist is that a still is a **placeholder for a shot's video**. The
upgrade path — generate the video, drop it into the same slot on the same lane,
keep the timing — only works if stills and videos are peers on one picture track.
A separate image lane would force a cross-track move for every upgrade and would
double every lane-aware code path (`computePoolDrop`, `makeTrack`, zIndex, FCPXML
lane packing). Per-item dispatch is strictly less code and matches the goal.

### Image item semantics

| field | image behavior |
|---|---|
| `kind` | `"image"` |
| `src` | `/storyboard-media/<file>`, or **`null` ⇒ slate** (see below) |
| `durationInFrames` | free — an image has no natural length |
| `sourceDurationInFrames` | **always absent.** Absent already means "uncapped resize" for legacy music items (`prd-editor-cut.md` §3), so images inherit exactly the behavior they need with zero new clamp logic |
| `offsetFrames` | **must be absent/0 and is ignored.** A still has no source timeline to seek into |
| `bundle`, `shot` | provenance (§3.1) |
| `stillFile` | which take is on screen (§3.1) |
| `volume`, `muted`, `fade*` | meaningless; never written, ignored if present |
| `flipH`, `flipV` | work as-is (a CSS transform on the element) |

**Invariants and the three places they bite** (each is a real code path that would
silently corrupt an image item):

1. **`resize edge:"start"`** (client drag `Editor.jsx:1904`-ish; worker op `timeline.js:186`-ish) applies `from += Δ, offsetFrames += Δ, durationInFrames -= Δ`. For `kind:"image"` it must move `from` and shrink `durationInFrames` **without touching `offsetFrames`**.
2. **`split`** produces a right half with `offsetFrames += leftLen`. For an image both halves keep `offsetFrames: 0` and simply share the `src`/`stillFile`. (Splitting a still is a legitimate way to hold the same frame across a cut point.)
3. **`withSourceDurations`** (`Editor.jsx:321`) probes media length via a media element. It must **skip image items** — probing a PNG as video yields `NaN`/0 and would clamp the item to nothing.

**Backward compatibility:** absent `kind` ⇒ `"video"`, so every saved timeline
loads unchanged. Normalize on load in `withSourceDurations` alongside the existing
`offsetFrames` normalization: for `kind:"image"` items force `offsetFrames = 0` and
delete `sourceDurationInFrames` (guards hand-edited and agent-written docs).

Update the shape comment at the top of `src/editor/timeline.js` — it is the model's
documentation and is vendored into `render-fn`.

### 3.1 Provenance (what makes "create new" possible)

On the **item**:

```js
bundle: "MS-01",       // already exists on cut-built items (there it's the bundle id)
shot: "MS-012",        // NEW — the shot this picture slot belongs to
stillFile: "MS-01_MS-012_gen2.png",  // NEW — which take is displayed (null on a slate)
```

`bundle` + `shot` are what the context menu needs to open the right modal;
`stillFile` is what "swap take" and "regenerate" operate on.

On the **still record** (`worker/src/routes/storyboard.js:82-89`) — today it stores
`file/name/angle/jobId/source/ts` and **nothing about how it was made**. Add:

```js
prompt: "…",                  // the exact text sent to the image model
model: "nano_banana_pro",     // resolved at runtime via models_explore, currently discarded
refs: [{ key, role, url }],   // the reference images actually used
shotSnapshot: { location, camera, action, dialogue, dur },  // shot data AT generation time
```

Without these, a regenerate modal can only reconstruct intent from the *current*
shotlist and the *current* ref picks — which is lossy the moment either changes,
and is exactly the "it knows the context where it was taken" requirement. `jobId`
is the only durable hook back to Higgsfield today and is usually `null` in
practice (the skill's own `attach_still` example omits it).

---

## 4. The animatic build

New `POST /api/animatic/to-editor` in a new `worker/src/routes/animatic.js`,
mirroring `radio.js`'s derive-don't-store discipline.

### Shot coverage and timing

Iterate the **shot list in order** (not the radio scenes — radio drops silent
shots). For each shot:

- `line` = the radio line for it, if any (`buildRadioView` keyed by `sh<n>`).
- **Duration** = the voiced take's duration when `line.take.ready`; otherwise the shot's planned `dur` from the shot list; otherwise `2s`. (`normalizeShot` guarantees `dur` exists as a number, defaulting `0` — so the fallback chain is `take.duration || shot.dur || 2`.)
- **Picture item** = the shot's selected still → an `kind:"image"` item; no still → a **slate** (`src: null`).
- **Dialogue item** = the ready take, at the same `from` as the picture item.
- Picture and dialogue for one shot get a shared `linkId` (`link_sh<n>`), so dragging a scene carries its line — this is free, existing machinery (`linkGroupOf`, `repackTrack`, link-aware `remove`).

Scenes are laid **gapless in shot order**. Note this is a deliberate improvement
on `buildRadioTimeline`, which packs *voiced lines* gapless and therefore
compresses out every silent beat: the animatic's dialogue track will contain gaps
where the episode is silent, which is what the episode actually sounds like.

### Resolving a shot's still

The join (§2) needs a `shot.id → { bundle, still }` index:

1. Read `episode-manifest.json` and build `shotId → bundleId` from `manifest.bundles[].shots[].id`. **The manifest is authoritative** because `db.stills` was keyed from it (the Episode tab only ever reaches stills from the manifest side).
2. Fall back to `packPreview(shots)` for shots absent from the manifest (shots added to the shot list after the manifest snapshot). Positional pack ids can disagree with the manifest, so this is a fallback, never the primary.
3. Take = the `selected` take for that shot, else the **newest** (`db.stills[bundle][shot]` is newest-last). Filter against one `listMediaSet(env, pid, "storyboard")` listing so a stale record never yields a broken `src` — same guard `GET /api/storyboard` already applies.

Return coverage counts (`shots`, `withStill`, `slates`, `voiced`, `unmatched`,
`fromPacks`) so the UI can say "34 shots · 12 stills · 22 slates" and so a
divergence surfaces as a number instead of silently producing an all-slate
animatic. `unmatched` catches a shot in no bundle at all; **shot-id drift
specifically shows up as `withStill` dropping to 0** (the re-packed ids still
resolve to a bundle — one with no stills under it), and `fromPacks` counts shots
resolved by the fallback rather than the manifest.

### The slate

An image item with `src: null` carrying `bundle`/`shot`/`name`. It renders as a
flat card with the shot id + action text (§6) rather than black, so the timing
reads correctly while the art is missing, and it's the right-click target for
"Generate still here". A slate is a **normal timeline item** — movable, trimmable,
splittable, deletable — which is why it's `src:null` rather than a separate
concept.

### Persistence

Append to `db.animaticVersions` (parallel to `db.radioVersions`), set
`db.editorTimeline`, broadcast on the timeline channel. Add
`POST /api/timeline/from-animatic` + surface them in `GET /api/timeline`'s picker
payload, exactly as radio versions do (`worker/src/routes/timeline.js:334-344`).
`source: { kind: "animatic", at }`.

⚠️ Like `radioVersions`, each entry stores its **whole timeline inline** in
`selections.json` with no pruning — see §11.

### Entry point

The Radio tab gets a second, primary action next to "Send to editor":
**"Build animatic"** → `POST /api/animatic/to-editor` → `navigate("/editor")`,
mirroring `sendToEditor` (`src/routes/radio.jsx:216`). "Send to editor" (audio
only) stays for the pure radio pass.

---

## 5. UI / UX — right-click authoring

Design principle, inherited from the split PRD: **direct manipulation, one modal
only where content must be authored.** The generate flow is the one place a modal
is correct — there's a prompt to read and edit.

### 5.1 Lane context menu (new)

Wrap each lane in a `ContextMenu` (`Editor.jsx` lane renderer). Right-clicking
empty lane space computes the frame under the cursor (reuse `computeDrop`'s
x→frame math) and offers:

- **Picture lane:** "Add scene here…" (opens the Scene modal, §5.3), "Paste"-adjacent entries later.
- **Audio lane:** "Add audio here…" (opens the Audio modal, §5.4).
- Both: "Add channel above/below" (existing `makeTrack` behavior, currently only reachable by an edge-drop during a pool drag — surfacing it here is nearly free).

Right-click on a clip keeps the existing item menu (a clip's `ContextMenuTrigger`
stops the event reaching the lane). No pointer-handler conflict: `onPointerDown`
already bails on `e.button !== 0` (`:480`).

### 5.2 Item context menu (extended)

Added to the existing menu (`:565`), above Split:

- On an **image/slate item**: **"New still…"** (opens the Scene modal for that item's `bundle`/`shot`) and **"Swap take ›"** (submenu of that shot's existing takes with thumbnails — instant, no generation, just `stillFile`+`src` swap).
- On a **video item** that has a `bundle`: **"New still from this shot…"** — the same modal, seeded from the clip's bundle. This is what makes "on current videos it knows the context where it was taken" true.
- On a **slate**: the primary entry reads "Generate still…" rather than "New still…".

### 5.3 The Scene modal

Opened with `{ bundle, shot, itemId }`. Content, in order:

- **Header:** `MS-01 / MS-012` + the shot's `location · camera · dur`.
- **Shot context** (read-only): action, dialogue — pulled live from the shot list.
- **Takes rail:** the shot's existing takes (`GET /api/storyboard`) with select-to-swap, and **"use as reference"** on a take (the "reuse image" requirement — the chosen take is passed to the agent as an additional image reference so the new generation keeps the framing).
- **Prompt** (`Textarea`): prefilled from the selected take's stored `prompt` when present (§3.1), else composed from the shot exactly as `renderStoryboardMessage` does today.
- **Angle** (`Input`): free-text, as the Episode tab already has.
- **References:** the bundle's picked library refs, shown as chips (the `refBlock` from `src/routes/episode.jsx:770`).
- **Actions:** Cancel · **Generate**.

**On Generate** — one uniform mechanism for both "add" and "regenerate":

1. If there's no item yet ("Add scene here"), the UI inserts a **slate** at the target frame locally via `mutate` (autosave persists it, undo covers it). If there is one, it's reused.
2. Send an agent turn (a new `renderAnimaticStillMessage` in `AgentProvider.jsx`, alongside the existing `renderStoryboardMessage`) instructing: load `generate-storyboard`, generate, `attach_still(bundle, shot, url, angle, prompt, model, refs)`, then `edit_timeline [{ op: "replace", id: "<itemId>", src: "<url>", stillFile: "<file>" }]`.
3. The agent's `edit_timeline` write carries no `clientId`, so the open Editor **live-reloads** and the still appears in place, keeping its `from`/`durationInFrames`. This is the same path the agent already uses for every timeline edit — no new sync machinery.

That is why the answer to "regenerate" is **replace in place, keep takes**: takes
already accumulate in `db.stills` (nothing is lost, and "Swap take" can flip back),
while the timeline slot is stable.

The modal is **the same component** for "add" and "regenerate" — the only
difference is whether the slate pre-exists.

### 5.4 The Audio modal

Same shape, thinner: pick an existing Sound Studio track/version (`GET /api/sounds`)
→ insert an audio item at the frame; or "Generate…" → slate-equivalent (a silent
placeholder item) + an agent turn ending in the same `replace` op. Phase 3.

### 5.5 Image items on the timeline

`TimelineItem` derives `isAudio` from `track.type` (`:449`); add
`isImage = item.kind === "image"`:

- **Art:** use `item.src` directly as the tiled `repeat-x` background instead of `useVideoThumb` (which must not run for images). A still tiled across its card *is* the correct filmstrip — every frame is that frame.
- **Slate:** no art; a muted diagonal-hatch card with `ImageOff` + the shot id.
- **Icon:** lucide `Image` (stills) / `ImageOff` (slate) instead of `Film`. Per project convention: named lucide imports, sized in px, no emojis.
- **Color:** stills `sky-500/*`, slates `amber-500/*`, against video `emerald` and audio `violet` — a glance at the picture track tells you how much is still art vs footage.
- **Hidden handles:** no fade handles (audio-only already), and the **left-trim handle stays** but drives the image path from §3.
- **Inspector:** show `shot` + take name for image items.

---

## 6. Preview & render correctness

### `src/editor/Composition.jsx`

Dispatch per item, not per track:

```jsx
track.type === "audio" ? <AudioItem …/>
  : item.kind === "image" ? <ImageItem item={item} zIndex={n - ti} />
  : <VideoItem …/>
```

`ImageItem` mirrors `VideoItem`'s `<Sequence>` wrapper (same `from`,
`durationInFrames`, `premountFor`, `style={{ zIndex }}` — the wrapper is required
by `premountFor`, per the comment at `:30`) containing either:

- `<Img src={item.src} style={{ width:"100%", height:"100%", objectFit:"contain", …flip }} />` — Remotion's `<Img>` handles its own `delayRender` so the headless render never captures a half-loaded image; or
- the **slate**: an `AbsoluteFill` with a dark fill and the shot label. Pure DOM, no asset, renders identically headless.

No `trimBefore`, no `volume`, no `pauseWhenBuffering` (nothing to buffer).

### The other two copies

1. **`render-fn`:** run `npm run sync` in `render-fn/` and redeploy. Unlike the split PRD's situation, the vendored copy is **currently in sync**, so this diff will contain only this feature.
2. **Daytona bundle:** rebuild via `worker/build-remotion-bundle.sh` and upload to R2 at the key served by `worker/src/routes/render.js:109`.

### Worker render — a required fix

`PREFIX_KIND` (`worker/src/routes/render.js:57`) maps root-relative srcs to
absolute `/files/…` URLs for the headless renderer. It has **no
`/storyboard-media/` entry**, so an animatic's image srcs would stay
root-relative and fail to load in the render. Add:

```js
"/storyboard-media/": "storyboard",
```

`absolutizeTracks` spreads items (`{ ...it, src }`), so `kind`/`shot`/`stillFile`
ride through untouched. Slates (`src: null`) skip the rewrite (the `src &&`
guard already handles it).

**Deploy order:** worker + both render paths **before or together with** the
frontend, so no offset-blind… *image-blind* renderer ever meets an animatic.

---

## 7. Worker API

### `worker/src/routes/animatic.js` (new)

- `POST /api/animatic/to-editor` — §4. 400 when the shot list is empty (an animatic with zero shots is meaningless); an all-slate animatic is **valid** and must succeed (that's the day-one state).
- `GET /api/animatic` (optional, Phase 2) — the coverage view (which shots have stills/takes) for the Radio tab's readiness column.

### `worker/src/routes/timeline.js`

- **New `replace` op** in `applyTimelineOps` (`:183`) — the one op this feature needs:
  ```json
  { "op": "replace", "id": "img_sh3", "src": "/storyboard-media/MS-01_MS-012_gen2.png", "stillFile": "MS-01_MS-012_gen2.png", "name": "MS-012 · still 2" }
  ```
  Swaps media **in place**: `from`, `durationInFrames`, `linkId`, `kind` all
  survive. Tolerant no-op on unknown id, like every neighbouring op.
- **`insert` op** (Phase 3, agent-initiated adds):
  `{ op:"insert", trackId, item:{…} }` — normalized/validated server-side.
- **Image guards** in `resize` (`edge:"start"` must not move `offsetFrames` on an image) and `split` (right half keeps `offsetFrames: 0`).
- `POST /api/timeline/from-animatic` + `animaticVersions` in the `GET /api/timeline` payload.

### `worker/src/routes/storyboard.js`

- Persist the §3.1 provenance fields in the `POST /api/storyboard/image` record (`:82-89`).
- **Switch this route to `updateDoc`** (the optimistic-concurrency read-modify-write in `worker/src/lib/docs.js:45`) instead of `readDoc`→`writeDoc`. It currently last-writer-wins on the shared `selections` doc; radio already uses `updateDoc` *specifically because* the agent attaches several takes back-to-back. A "generate stills for every shot" loop — which this feature makes attractive — would clobber takes today. This is a **pre-existing bug** that this feature's usage pattern turns from theoretical into likely.

---

## 8. Agent surface

- **`agent/tools/attach_still.ts`:** add `prompt`, `model`, `refs`, `shotSnapshot` to the `inputSchema` (all optional, so existing turns keep working), and pass them through to `POST /api/storyboard/image`.
- **`agent/tools/edit_timeline.ts`:** add `"replace"` (and later `"insert"`) to the op enum; add `src`, `stillFile`, `name`, `item` optional fields; extend the tool description with a `replace` line.
- **`agent/skills/generate-storyboard/SKILL.md`:** record the resolved model id and the composed prompt, and pass both to `attach_still` (`:104-111`); add the "then `edit_timeline` replace to land it on the animatic" step, gated on the turn supplying an item id.
- **`agent/skills/edit-video/SKILL.md`:** document `kind:"image"` in the item shape, and that images have no `sourceDurationInFrames`/`offsetFrames`.
- **New `agent/skills/animatic/SKILL.md`** (Phase 3): the "fill every empty slate" loop — `get_timeline` → for each slate item, generate + attach + replace.

---

## 9. FCPXML / DaVinci Resolve export

`worker/src/lib/fcpxml.js` assumes every non-audio asset is a video:

- **Asset flags** (`:164-165`): the binary is `hasVideo="0" hasAudio="1"` (audio) : `hasVideo="1" hasAudio="1"` (everything else). An image asset would be declared as **having an audio track**, which Resolve will try to conform. Needs a third branch: `hasVideo="1" hasAudio="0"`.
- **Asset duration** (`:123-130`): images have no `sourceDurationInFrames`, so the existing fallback `(offsetFrames||0) + (durationInFrames||1)` already yields a sane length. Verify against Resolve's convention for stills (`duration="0s"` on the asset is the FCPXML idiom for a timeless image) — this is the one export detail that needs a real round-trip test before we trust it.
- **`asset-clip` `start`** (`:206`): `rt(item.offsetFrames || 0)` → `0s` for images. Correct as-is, given the §3 invariant.
- **Slates** (`src: null`) must be **skipped entirely** on export — there is no asset to reference. A slate is a working placeholder, not a deliverable.
- **`scripts/check-fcpxml.mjs`:** add an image case asserting `hasAudio="0"` and that a slate produces no asset/clip.

---

## 10. Phasing

### Phase 1 — images on the timeline (one deployable unit)

1. Model: `kind` + normalization + the three invariant guards (`withSourceDurations`, client `resize-start`, worker `resize`/`split`).
2. `ImageItem` + slate in `src/editor/Composition.jsx`; shape comment in `src/editor/timeline.js`.
3. `TimelineItem` image rendering (art, icon, colors, no fades).
4. Render propagation: `PREFIX_KIND` fix; `render-fn` sync + deploy; Daytona bundle rebuild.
5. FCPXML image flags + slate skip + `check-fcpxml.mjs` case.

*Ships with no user-visible feature — it's the substrate. Verify by hand-writing an image item into a timeline (or via `edit_timeline`) and rendering it.*

### Phase 2 — the animatic build

6. `worker/src/routes/animatic.js` (`to-editor`, manifest-first join, coverage counts), `animaticVersions`, `from-animatic`, Editor version picker.
7. Radio tab "Build animatic" button + coverage summary.

*First user-visible payoff: watch the episode.*

### Phase 3 — right-click authoring

8. Provenance: `storyboard.js` fields + `updateDoc` fix; `attach_still.ts` schema; `SKILL.md`.
9. Worker `replace` op; `edit_timeline.ts` schema.
10. Lane context menu + item menu entries ("New still…", "Swap take ›").
11. The Scene modal + `renderAnimaticStillMessage`.
12. Audio modal (§5.4).

### Phase 4 — polish / groundwork

- Grabbed stills and storyboard stills draggable from the pool (`mediaType: "image"`, `StillCard` drag, `computePoolDrop` mapping image→video lanes). `addPoolClip` already defaults to 3s for a missing duration.
- "Generate video from this scene" on an image item — the still→video upgrade the model was designed for (§3).
- Ken Burns.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Shot ids silently drift out of the stills key space.** `save_shotlist` makes `id` optional and `POST /api/shotlist` re-normalizes positionally, so an agent write that omits ids rewrites `"MS-012"` → `"01"` while `db.stills` keeps the old keys. Every still orphans, with no error. | FIXED at the source: `POST /api/shotlist` preserves stored ids when the save omits them (index-inheritance only when the shot count is unchanged — once shots are inserted, position N is a different shot and inheriting would mis-key a still onto the WRONG shot, which is worse than orphaning), returns `idsPreserved`/`idsInvented` + an explicit warning, and `save_shotlist` now tells the model to carry ids through. **Note:** drift shows up as `withStill` collapsing to 0, NOT as `unmatched` — `packPreview` re-packs the new ids into valid bundles, so they still resolve to *a* bundle, just one with no stills under it (verified) |
| Manifest is a frozen snapshot never written by the worker (`buildBundles` is dead code; the doc was migrated once); `packPreview` re-packs positionally and can disagree | Manifest-first join with packPreview fallback (§4); report `unmatched` |
| Concurrent `attach_still` calls clobber `selections.json` (last-writer-wins) — likely once "generate all stills" exists | FIXED: storyboard writes go through `updateDoc`. Verified with 6 parallel attaches — all 6 takes survive. This fix then exposed a filename collision (see the divergence list above), also fixed |
| `selections.json` grows by a whole timeline per animatic build (inherited from `radioVersions`) | FIXED: `lib/versions.js` caps both `radioVersions` and `animaticVersions` at `MAX_VERSIONS` (10) and derives `v` from the highest ever seen, so pruning can't recycle a version number |
| Image-blind renderer meets an animatic (deploy skew) | Deploy worker + both render paths first; absent-`kind`⇒video keeps old docs valid forever |
| `withSourceDurations` probes a PNG as video → clamps the item to nothing | Explicit skip, called out in §3 as an invariant, not an afterthought |
| Resolve's still convention (`duration="0s"`) may differ from the asset-duration fallback | Round-trip one animatic into Resolve before Phase 1 cutover (§12) |
| Radio's gapless-voiced-lines layout vs the animatic's gapless-shots layout diverge in length, confusing "why is my animatic longer?" | Intentional and correct (§4); surface shot count + duration in the build result |
| Scope creep into a full storyboard editor inside the Editor | The modal authors **one still for one shot**; bulk generation stays on the Episode tab where it already lives |

---

## 12. Verification plan

**Automated** (the only existing harness): `node scripts/check-fcpxml.mjs` with the image + slate cases (§9).

**Manual** (dev stack: `npm run stack` / `npm run worker:dev`):

1. **Phase 1:** hand-insert an image item + a slate into a timeline → both show correct art/placeholder in the `<Player>`, hold for their duration, and letterbox on black.
2. Trim an image's right edge past any length (uncapped); left-trim it → the image does not "seek" (no `offsetFrames` drift); split it → two holds of the same frame; Cmd+Z restores each in one step.
3. Deliver render (Daytona) **and** a render-fn render of a timeline containing stills + a slate → output matches the preview. (This is the step that catches the `PREFIX_KIND` fix.)
4. Export to FCPXML → import in Resolve: stills appear as stills with no phantom audio track; slates are absent.
5. **Phase 2:** with **zero** stills generated, Build animatic → every shot is a slate, timing matches the shot list's `dur`, voiced shots are timed by their takes, and silent shots leave audible gaps. With **some** stills → mixed picture track; counts match the summary.
6. Reload the Editor → the animatic persisted; the version picker lists it; `from-animatic` reloads it.
7. Drag a scene → its dialogue line moves with it (linkId); delete it → both go.
8. **Phase 3:** right-click empty picture lane → "Add scene here…" → Generate → a slate appears instantly, and the still lands **in that slot** when the agent finishes (validates the live-sync `replace` path).
9. Right-click an existing still → "New still…" → the modal shows the correct shot context and the stored prompt; generate → item swaps in place, both takes remain under "Swap take ›".
10. Right-click a **video** clip from a cut → "New still from this shot…" → the modal opens on that clip's bundle.
11. Generate stills for two shots concurrently → both takes survive (validates the `updateDoc` fix).

---

## Appendix: files touched per phase

| File | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| `src/editor/timeline.js` (shape comment) | ✔ | | | |
| `src/editor/Composition.jsx` (`ImageItem`, slate, dispatch) | ✔ | | | |
| `src/components/Editor.jsx` | image cards, guards, normalization | version picker | lane menu, item menu, Scene/Audio modals | pool drag |
| `render-fn/remotion/*` (via `npm run sync`) + deploy | ✔ | | | |
| Daytona bundle (`worker/build-remotion-bundle.sh`) + upload | ✔ | | | |
| `worker/src/routes/render.js` (`PREFIX_KIND`) | ✔ | | | |
| `worker/src/lib/fcpxml.js` + `scripts/check-fcpxml.mjs` | ✔ | | | |
| `worker/src/routes/animatic.js` (**new**) | | ✔ | | |
| `worker/src/routes/timeline.js` (`from-animatic`, versions) | image guards | ✔ | `replace`/`insert` ops | |
| `worker/src/routes/storyboard.js` (provenance, `updateDoc`) | | | ✔ | |
| `src/routes/radio.jsx` (Build animatic) | | ✔ | | |
| `src/components/AgentProvider.jsx` (`renderAnimaticStillMessage`) | | | ✔ | |
| `agent/tools/attach_still.ts`, `agent/tools/edit_timeline.ts` | | | ✔ | |
| `agent/skills/generate-storyboard/SKILL.md`, `edit-video/SKILL.md`, `animatic/SKILL.md` | | | ✔ | |
