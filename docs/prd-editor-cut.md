# PRD: Cut (split / trim) in the Editor

**Status:** proposed · **Scope:** technical design only, no implementation yet
**Surfaces touched:** Editor UI, Remotion compositions (×3), Worker timeline API, eve agent tools, FCPXML export

---

## 1. Overview

Add **cut** functionality to the Remotion-based Editor tab:

- **Split at playhead (razor):** cut a timeline clip into two independent clips at the playhead, non-destructively.
- **Source in-point trimming:** let a clip start partway into its source media (today trims are end-only), which is the primitive a split requires and what a future left-edge trim drag builds on.

Everything is **metadata-only**. No new media files are produced, no ffmpeg runs, nothing re-encodes. A split is a pure timeline-JSON edit that renders correctly in the live preview and in both headless render paths.

### Naming note

In this app, "cut" already means a *complete-cut generation* (a stitched episode video in `db.cutHistory`, surfaced in the Cuts tab). This PRD uses "cut" in the editing sense: razor/split/trim of timeline clips. UI copy should say **"Split"** to avoid the collision.

### Goals

1. Split any video or audio clip (and its linked partner) at the playhead with one action (button, `S` key, or context menu).
2. Split clips play the correct source frames in the Player preview, the Daytona "Deliver" render, and the Vercel `render-fn` render.
3. Splits survive autosave/reload, undo cleanly, live-sync to other tabs, and round-trip to DaVinci Resolve via FCPXML with correct in-points.
4. The eve agent can perform splits via `edit_timeline` (Phase 3).

### Non-goals

- No physical/ffmpeg cutting of media. The existing server-side take trim (`POST /api/episode/trim`, which mints a new `_trimN.mp4` take file) is a **different feature** and stays exactly as-is.
- No ripple-edit-everything or magnetic timeline. Existing gap selection/close-gaps behavior is unchanged.
- No persistent razor *tool mode* (see §5).
- No playback-rate / slip / slide edits (out of scope, but `offsetFrames` is the field they'd build on).

---

## 2. Current state (verified)

- **Model** (`src/editor/timeline.js`, FPS = 24): a timeline is `{ fps, width, height, source, tracks:[{ id, type, items }] }`. Video items: `{ id, src, name, bundle, from, durationInFrames, sourceDurationInFrames, volume, linkId?, muted?, disabled?, flipH?, flipV? }`; audio items add `track`, `fadeInFrames?`, `fadeOutFrames?`. **There is no source in-point field** — a clip always plays from source frame 0, so trimming is end-only (`durationInFrames` clamped to `sourceDurationInFrames`). Confirmed by grep across `src/`, `render-fn/`, `worker/`, `agent/`.
- **Persistence:** the whole timeline JSON lives in the R2 doc `state/<pid>/selections.json` under `db.editorTimeline`. The UI autosaves wholesale (`POST /api/timeline`, 600 ms debounce, stamped with `CLIENT_ID`); the agent edits via granular ops (`POST /api/timeline/edit` → `applyTimelineOps`, `worker/src/routes/timeline.js:165`): `move, resize (end-only), remove, volume, mute, disable, reorder, repack` — **no split**. No D1 involvement; no migration needed.
- **Rendering (three copies of the composition must agree):**
  1. `src/editor/Composition.jsx` — live preview in `<Player>`; `<Video>` in preview, `<OffthreadVideo>` when rendering, `<Audio>` for audio; each in a `<Sequence from durationInFrames premountFor={fps*2}>`.
  2. `render-fn/remotion/Composition.jsx` — Vercel render path. **Currently stale** relative to `src/editor/` (missing premount/flip/zIndex changes); `render-fn` has `npm run sync` (`render-fn/scripts/sync-composition.mjs`) that regenerates it.
  3. The Daytona "Deliver" render (`worker/src/routes/render.js`) pulls a prebuilt bundle `remotion-bundle/editor.tar.gz` from R2. The `worker/build-remotion-bundle.sh` referenced in a comment (`render.js:9`) **does not exist in the repo** — rebuilding the bundle is undocumented.
- **Remotion API** (remotion@4.0.486, verified against docs and installed types): `trimBefore` / `trimAfter` (frames) are the current source-trim props on `<Video>`, `<OffthreadVideo>`, and `<Audio>`; `startFrom`/`endAt` are deprecated aliases. Remotion implements `trimBefore` as an inner negative-`from` sequence, and the frame passed to a `volume` callback stays **clip-relative** (`useFrameForVolumeProp` adds `cumulatedNegativeFrom`), so the existing audio fade envelope math in `AudioItem` needs no change.
- **Pre-existing bug (must fix alongside this feature):** `broadcastTimeline = (c, pid, clientId)` (`worker/src/routes/timeline.js:229`) but all three call sites pass two args — `broadcastTimeline(c, clientId)` (lines 308, 323, 342). The client id lands in the `pid` slot, so timeline SSE broadcasts key the wrong Durable Object and echo-suppression `clientId` is always `null`. Split UX leans on live-sync behaving correctly, so this fix ships with Phase 1.
- **What already works with zero changes:** snapping (`snapFrom`, `Editor.jsx:1816`) and playhead targets (`playheadTargets`, `:1955`) enumerate every item's `from`/end dynamically, so split-created boundaries become snap/navigation targets automatically; `gotoClip` (Up/Down) treats every `from` as a cut point; a split leaves no gap so `gapsFor` is unaffected.
- **Test infra:** none except `scripts/check-fcpxml.mjs`, a pure assertion script over the FCPXML builder.

---

## 3. Data model — `offsetFrames` (the keystone)

Add one optional integer field to **all** timeline items (video and audio):

```js
offsetFrames?: number   // source in-point, in frames at timeline fps. Absent ⇒ 0.
```

**Semantics:** the item plays source frames `[offsetFrames, offsetFrames + durationInFrames)` at timeline position `[from, from + durationInFrames)`.

**Invariants:**

- `offsetFrames ≥ 0`, integer.
- When `sourceDurationInFrames` is known: `offsetFrames + durationInFrames ≤ sourceDurationInFrames`.
- The end-trim cap changes from `sourceDurationInFrames` to **`sourceDurationInFrames − offsetFrames`** everywhere it is enforced (client resize drag, worker `resize` op).
- Items without `sourceDurationInFrames` (legacy music items from `buildTimelineFromCut`, which never sets it on audio) remain uncapped for resize, exactly as today. Splitting them is still valid — split math needs no cap.

**Naming:** matches the existing `*Frames` convention (`durationInFrames`, `fadeInFrames`, `sourceDurationInFrames`).

**Backward compatibility:** absent means 0, so every saved timeline loads unchanged and old docs stay valid forever. Extend `withSourceDurations` (`src/components/Editor.jsx:321`) to normalize on load: `it.offsetFrames = Math.max(0, Math.round(it.offsetFrames || 0))` for all items on both track types, and defensively clamp `durationInFrames` to `sourceDurationInFrames − offsetFrames` when the cap exists (guards hand-edited docs). Update the canonical shape comment at the top of `src/editor/timeline.js` — that comment is the model's documentation and is vendored into `render-fn`.

---

## 4. Split semantics

New `splitAtPlayhead()` in `Editor.jsx` (natural home: next to `flipClipAtPlayhead`, `:1221`).

1. `f = Math.round(frameRef.current)`.
2. **Target set:** if any selected clip (`selectedIds`) *strictly contains* `f`, targets = the selected clips containing `f`. Otherwise targets = **all non-disabled clips on all tracks** strictly containing `f` (razor-across-tracks — the common case of "park the playhead, press S"). *Strictly contains* means `from + 1 ≤ f ≤ from + durationInFrames − 1`, so both halves are ≥ 1 frame.
3. **Link expansion:** for each target with a `linkId`, add every `linkGroupOf` partner that also strictly contains `f` — splitting a video splits its detached audio at the same frame.
4. Empty target set → **no-op with no history push** (check before calling `mutate`; a non-silent `mutate` pushes an undo snapshot, `Editor.jsx:1123`). Double-pressing `S` on the same frame is therefore harmless — the second press finds no strictly-containing clip.
5. For each target, inside **one** `mutate()` call:

   | | Left half | Right half (new item) |
   |---|---|---|
   | identity | keeps original `id` | new unique id, `` `${id}_r${seq}` `` (monotonic suffix — reuse the `poolSeqRef` pattern, `:776`) |
   | position | `durationInFrames = f − from` | `from = f`, `durationInFrames = oldDur − leftDur` |
   | source | `offsetFrames` unchanged | `offsetFrames = (old.offsetFrames ?? 0) + leftDur` |
   | fades | keeps `fadeInFrames` (clamped to new duration), **drops `fadeOutFrames`** | `fadeInFrames = 0`, inherits `fadeOutFrames` (clamped) |
   | copied props | — | `src, name, bundle, volume, muted, disabled, flipH, flipV, sourceDurationInFrames, track` |
   | placement | in place | inserted immediately after the left in the same `track.items` |

6. **linkIds for right halves:** group right halves by their original `linkId`; if ≥ 2 right halves came from one link group, give them one fresh shared `linkId`; a lone right half gets **no** linkId (keeping the old one would tether it to the left group).
7. **Selection after split:** select the right halves (primary = the right half of the primary selection, else the topmost video's right half). This makes "split, then Delete the tail" a two-keystroke flow — `removeSelected` (`:1358`) already handles multi-selection and link groups.

**Example** — splitting this 72-frame clip at timeline frame 100:

```jsonc
// before
{ "id": "v3_1_MS-02", "src": "/gen/MS-02.mp4", "from": 72, "durationInFrames": 72,
  "sourceDurationInFrames": 72, "volume": 1 }

// after                                        (split at f = 100 → leftLen = 28)
{ "id": "v3_1_MS-02",    "src": "/gen/MS-02.mp4", "from": 72,  "durationInFrames": 28,
  "sourceDurationInFrames": 72, "volume": 1 },
{ "id": "v3_1_MS-02_r1", "src": "/gen/MS-02.mp4", "from": 100, "durationInFrames": 44,
  "offsetFrames": 28, "sourceDurationInFrames": 72, "volume": 1 }
```

**Undo:** one `mutate` = one snapshot = one Cmd+Z.
**Persistence:** the existing debounced wholesale autosave (`Editor.jsx:1064`) persists the split — **the UI path needs no new endpoint**. SSE broadcast to other tabs is automatic.

---

## 5. UI / UX

Design principle: split is a **one-shot, playhead-anchored action**, not a modal razor tool (the Final Cut `Cmd+B` pattern). A Premiere-style persistent razor mode is explicitly rejected: it adds tool state, causes mode errors, and buys nothing when the playhead already defines the cut point. No modals anywhere in this feature — direct manipulation plus the existing Radix context-menu/tooltip primitives (per project conventions: shadcn components, lucide icons, no emojis).

### Toolbar (`Editor.jsx:2529`-ish, between Undo and Close gaps)

- **Split** button: lucide `Scissors` icon + "Split" label, `aria-label`, tooltip/title `"Split the clip(s) at the playhead (S)"`. `disabled` when no clip strictly contains the playhead (cheap to compute per render — the toolbar already re-renders every frame via `setFrame`).
- **Icon collision:** "Close gaps" currently uses `Scissors` (`:2540`). Reassign Close gaps to lucide `FoldHorizontal` and give Split the scissors (fallback if the installed lucide version lacks it: give Split `SquareSplitHorizontal` instead).

### Keyboard

- **`S`** (no modifiers), added to the keydown handler (`:1145`) behind the existing `!typing` guard and `!e.metaKey && !e.ctrlKey`, wired through `keyCtxRef` like `stepFrame`/`gotoClip`. `S` collides with nothing (current map: Cmd+Z, Delete/Backspace, D, Space, arrows) and reads as "split". A `Cmd+B` alias can come later; ship one binding.
- Update the shortcuts help paragraph (`~:2793`) with one line.

### Context menu (`TimelineItem`, `:514`–543)

- New "Split at playhead" entry with `<Scissors size={14} />` and an `S` shortcut hint, above Disable. Pass `onSplit(item.id)` + a `canSplit` boolean computed in the lane renderer from the current frame; disabled when the playhead isn't strictly inside the clip. `TimelineItem` isn't memoized and already re-renders per frame, so the extra prop costs nothing new.

### Clip visuals must become offset-aware

- **`Waveform`** (`:276`, caller `:413`): replace the 0-anchored `trimFraction` prop with a window: caller passes `winStart = offset / srcDur`, `winEnd = (offset + dur) / srcDur` (fallback `0..1` when `srcDur` unknown, as today); the paint loop maps `x → peaks[floor((winStart + (x/W)·(winEnd−winStart)) · peaks.length)]`. A split music clip then shows two contiguous waveform halves.
- **Filmstrip** (`:445`): it's a single first-frame thumbnail tiled with `repeat-x` — offset-agnostic, **no MVP change**. Phase 2 nicety: key `useVideoThumb` on `src + offset` and capture the thumb at `offsetFrames / fps` so a right half shows its actual first frame.
- **Inspector** (`~:2755`): add a small read-only "Source in" cell (`fmtTime(framesToSec(offsetFrames))`) when `offsetFrames > 0` — cheap, and makes the invisible state legible.

### Interactions that must respect the offset

- **Right-edge resize drag** (`onDragStart` resize branch, `:1904`): snapshot `offset` into the drag group records (`:1867`-ish) and clamp `next ≤ srcDur − offset`.
- **`detachAudio`** (`:1274`): the created audio item must copy `offsetFrames` from the video, or detaching audio from a right half plays the wrong sound.
- **Stills** (`grabStill`, `:969`): correct automatically — the `<video>` element's `currentTime` already includes the trim offset, so `captureStillFromSource(clip.src, matched.currentTime)` grabs the right source frame. Optionally add `sourceTimeSec` to the still meta.

### Phase 2: left-edge trim handle

Mirror of the existing right-edge handle (`:508`): new drag mode `"resize-start"` that keeps the clip's end anchored and applies `{ from += Δ, offsetFrames += Δ, durationInFrames −= Δ }` per pointer move, clamped to `offsetFrames ≥ 0` (head-extension headroom = current offset), `durationInFrames ≥ 1`, `from ≥ 0`; linked partners trim together; magnet snapping of the start edge via `snapFrom`-style targets. With the offset-aware waveform/filmstrip window, trimmed-off media visually "slides" rather than disappearing.

---

## 6. Preview & render correctness

### Live preview — `src/editor/Composition.jsx`

- `VideoItem` (`:26`–61): add `trimBefore={item.offsetFrames || undefined}` to the clip element (prop exists on both `<Video>` and `<OffthreadVideo>`). Interaction with `premountFor` is the supported combination — the premounted element seeks to the trimmed time while invisible; `pauseWhenBuffering` unchanged.
- `AudioItem` (`:63`–91): add `trimBefore={item.offsetFrames || undefined}` to `<Audio>`. Fade math unchanged (see §2, volume-callback frames are clip-relative).
- The 720p proxy swap (`playerInputProps` → `toPreviewSrc`) only rewrites `src`, so it is unaffected.

### Render paths — **ship with the MVP, not later**

A timeline containing offsets must never reach an offset-blind renderer:

1. **Vercel render-fn:** run `npm run sync` in `render-fn/` (regenerates `render-fn/remotion/*` from `src/editor/*`) and redeploy. ⚠️ The vendored copy is currently stale, so this sync also pulls previously-unsynced `premountFor`/flip/zIndex changes — review that diff deliberately and smoke-render once before cutover.
2. **Daytona bundle:** rebuild the Remotion bundle from `src/editor/RemotionRoot.jsx`, tar to `editor.tar.gz`, upload to R2 at the key served by `/files/remotion-bundle/editor.tar.gz` (`worker/src/routes/render.js:109`). **Deliverable: create `worker/build-remotion-bundle.sh`** so this step is scripted instead of tribal knowledge (the script is referenced in comments but missing from the repo).
3. `absolutizeTracks` (`render.js:61`) spreads items (`{ ...it, src }`), so `offsetFrames` rides through untouched — no change.

**Deploy order:** worker + both render paths **before or together with** the frontend.

---

## 7. Worker API (agent path)

In `worker/src/routes/timeline.js` — `applyTimelineOps` (`:165`) and its op-docs comment (`:155`):

### New `split` op

```json
{ "op": "split", "id": "v7_2_MS-05", "at": 172 }
```

- `at` = **absolute timeline frame** (consistent with `move.from`).
- Validate `from + 1 ≤ at ≤ from + durationInFrames − 1`; otherwise silently no-op (matches the tolerant style of the other ops).
- Mirrors the client algorithm exactly (§4 step 5): mutate left in place, insert right after it, `offsetFrames += leftLen`, fades partitioned, linked partners containing `at` split too, fresh shared linkId for ≥ 2 right halves. Server generates right-half ids as `` `${id}_r${Date.now()}` `` (verify uniqueness via `findItem`). The endpoint already returns the whole updated timeline, so the agent sees the new ids.

### Extended `resize` op

```json
{ "op": "resize", "id": "v7_2_MS-05", "durationInFrames": 96, "edge": "start" }
```

- `edge` optional, default `"end"` (fully backward compatible).
- `"end"`: current behavior, but fix the clamp to `sourceDurationInFrames − (offsetFrames || 0)` (`:186` — this clamp fix is needed even without `edge`).
- `"start"`: keep the clip's end anchored: `delta = oldDur − newDur`; apply `from += delta`, `offsetFrames += delta`, `durationInFrames = newDur`; clamps `newDur ≥ 1`, `offsetFrames ≥ 0`, `from ≥ 0`.

### Also in this file

- `buildTimelineFromCut` (`:72`): emit explicit `offsetFrames: 0` on video items for doc self-description (optional — absent-means-0 keeps it non-required).
- **Fix the `broadcastTimeline` bug:** call sites at `:308`, `:323`, `:342` must pass `(c, pid, clientId)`.

---

## 8. Agent surface

- **`agent/tools/edit_timeline.ts`:** add `"split"` to the op enum; add `at: z.number().optional()` ("Timeline frame to split at (for split)") and `edge: z.enum(["start","end"]).optional()` ("Which edge resize trims (default end); 'start' trims the head and advances the source in-point"). Extend the tool description with:
  - `- split: cut a clip into two at a timeline frame — { op:'split', id, at } (both halves ≥ 1 frame; linked audio splits too)`
  - a note that `resize` accepts `edge:'start'`.
- **`agent/skills/edit-video/SKILL.md`:** add the split recipe — "Split a clip at a time → `{ op:'split', id, at: Math.round(seconds * fps) }`; the right half is a **new item** — re-read the returned timeline for its id" — and mention `offsetFrames` in the item-shape description.
- `get_timeline` needs no change (returns raw items; `offsetFrames` flows through automatically).

---

## 9. FCPXML / DaVinci Resolve export

`worker/src/lib/fcpxml.js` currently hardcodes the source in-point:

- `asset-clip` emit (`:200`): `start="0s"` → `start="${rt(item.offsetFrames || 0)}"`. FCPXML's `start` attribute *is* the source in-point; `offset` (timeline position) and `duration` are unchanged. Fade elements are clip-relative in FCPXML and stay correct.
- Asset duration (`~:122`): when `sourceDurationInFrames` is missing, the declared asset duration must cover the deepest usage: `const d = it.sourceDurationInFrames || ((it.offsetFrames || 0) + (it.durationInFrames || 1))` — otherwise Resolve sees clips reading past their asset's declared length.
- Update the header comment (currently states "no source in-point: `start` is always 0s").
- **`scripts/check-fcpxml.mjs`:** add a case with `offsetFrames` asserting the `asset-clip` carries `start="<offset>/24s"` and the asset duration covers `offset + duration`.

**This ships in Phase 1.** Once the editor can produce offsets, an unpatched exporter silently exports the wrong frames.

---

## 10. Phasing

### Phase 1 — MVP: split at playhead + offsets honored everywhere (one deployable unit)

1. Model: `offsetFrames` + normalization (`timeline.js` shape comment, `withSourceDurations`).
2. `trimBefore` in `src/editor/Composition.jsx` (video + audio).
3. `splitAtPlayhead` + toolbar button (+ Close-gaps icon reassignment) + `S` key + context-menu entry + right-halves selection.
4. Offset-aware clamps: client resize drag + worker `resize` clamp.
5. `Waveform` windowing; `detachAudio` copies `offsetFrames`.
6. FCPXML `start` mapping + asset-duration fallback + check-fcpxml case.
7. Render-path propagation: `render-fn` sync + deploy; rebuild/upload Daytona bundle; **create `worker/build-remotion-bundle.sh`**.
8. Fix the `broadcastTimeline` call sites.

### Phase 2 — left-edge trim + polish

- `"resize-start"` drag mode with snapping and linked-partner trimming.
- Offset-aware filmstrip thumbnails; inspector "Source in" cell (if not done in P1).
- Optional: ripple delete ("delete and close gap", composed from existing `remove` + `repack` behavior).

### Phase 3 — agent surface

- Worker `split` op + `resize.edge` (§7), `edit_timeline.ts` schema + `SKILL.md` (§8).
- Kept last deliberately: the UI path needs no server op (autosave is wholesale), so the agent op mirrors a by-then-proven client algorithm.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stale `render-fn` vendored copy: syncing now also ships premount/flip changes untested on that path | Review the sync diff explicitly; smoke-render one timeline on render-fn before cutover |
| Daytona bundle rebuild is undocumented (script referenced but missing) | Create `worker/build-remotion-bundle.sh` as a Phase 1 deliverable; verify one Deliver render end-to-end |
| Deploy skew: offset-blind renderer receives a split timeline | Deploy worker/render paths first; absent-⇒-0 keeps old docs valid forever |
| SSE echo-suppression bug (`broadcastTimeline` args) causes reload-during-edit weirdness that will be blamed on split | Fix the three call sites in Phase 1 |
| Fade envelope vs `trimBefore` frame semantics | Verified in Remotion source (volume frame is clip-relative); still manually test a split faded music clip |
| 720p proxy seek accuracy at split points (± 1 frame in live preview) | Accepted for preview; headless render uses `<OffthreadVideo>` on originals and is frame-accurate; noted here |
| Split at exact clip edge / double-press `S` | Strict-interior guard + no-op without a history push |
| Undo of split followed by autosave | `mutate` snapshot covers it; autosave is wholesale-replace so server state always converges |

---

## 12. Verification plan

**Automated** (the only existing harness): extend and run `node scripts/check-fcpxml.mjs` with the offset case (§9).

**Manual flows** (dev stack: `npm run stack` / `npm run worker:dev`):

1. Load a cut → park playhead mid-clip → `S` → two cards appear; Up/Down (`gotoClip`) and playhead snapping land on the new boundary; the right half plays the correct continuation frame (compare against pre-split playback).
2. Split a pool-dropped video that has linked detached audio: both split at the same frame; the right pair moves/deletes together under a fresh linkId, independent of the left pair.
3. Right-edge-trim a right half: cannot extend past `sourceDurationInFrames − offsetFrames`.
4. Split a music clip that has fade-in and fade-out: fade-in stays left, fade-out goes right, waveform shows two contiguous windows, audible fades are correct.
5. Cmd+Z restores the pre-split state in one step; autosave indicator cycles; reload the tab — the split persisted and previews correctly.
6. `S` with the playhead exactly on a clip edge: no-op, no undo entry.
7. Grab a still on a right half: captured frame matches the preview frame.
8. Deliver render (Daytona) and a render-fn render of a split timeline: output matches the preview at the split boundary.
9. Export for Resolve → import in DaVinci: both halves carry correct source in-points (right half does not restart at source 0).
10. (Phase 3) Agent `edit_timeline` with `{ op:'split', … }` → an open Editor tab live-reloads showing the split (also validates the broadcast fix).

---

## Appendix: files touched per phase

| File | P1 | P2 | P3 |
|---|---|---|---|
| `src/editor/timeline.js` (shape comment) | ✔ | | |
| `src/editor/Composition.jsx` (`trimBefore`) | ✔ | | |
| `src/components/Editor.jsx` (split, toolbar, key, menu, waveform window, clamps, detachAudio, normalization) | ✔ | left-trim drag, thumbs, inspector | |
| `render-fn/remotion/*` (via `npm run sync`) + deploy | ✔ | | |
| `worker/build-remotion-bundle.sh` (**new**) + bundle upload | ✔ | | |
| `worker/src/routes/timeline.js` (resize clamp, broadcast fix) | ✔ | | `split` op, `resize.edge` |
| `worker/src/lib/fcpxml.js` + `scripts/check-fcpxml.mjs` | ✔ | | |
| `agent/tools/edit_timeline.ts`, `agent/skills/edit-video/SKILL.md` | | | ✔ |
