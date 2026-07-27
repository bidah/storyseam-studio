# OpenCut → shot-studio **mobile** timeline: polish backlog

_Scope: web (Remotion) is fine and stays as-is. Per-platform implementations are the plan — no shared
core. This is only about **what to borrow from [OpenCut](https://github.com/OpenCut-app/OpenCut) to
make the mobile timeline (`mobile-app/src/editor/`) behave correctly.** Findings grounded in our
actual mobile ops files. OpenCut (classic) is MIT, so patterns/code are free to lift._

## The "mobile version" question — there isn't one
Neither OpenCut repo ships a mobile app. The linked repo is a from-scratch rewrite (web skeleton +
Rust/GPUI desktop stubs; mobile is a README roadmap bullet, no code). The mature editor
(`opencut-classic`, archived) is web + desktop only and literally **blocks phones** via
`mobile-gate.tsx`. So there's no mobile UI to copy — only their **timeline math and edit-model
patterns**, which are framework-agnostic pure functions and map straight onto our mobile `ops/`.

---

## What our mobile timeline already does well (leave alone)
- **Snapping** (`ops/snap.ts`) already *is* OpenCut's pattern: collect targets (0 + playhead + every
  clip edge, excluding dragged + partners) → nearest-within-threshold on both start and end edge,
  pixel radius converted to frames. Nothing to borrow here. Only future extension: add more snap
  *sources* (markers/keyframes) — trivial when needed.
- **Black-blink on cuts** — the A/B `expo-video` double-buffer + pre-seek + slot-swap already solves
  it. OpenCut's web "hold last decoded frame" trick is just confirmation we did it right.
- **Undo gesture-bracketing** (`useTimelineHistory`) — begin/end/cancel around a gesture so a whole
  drag is one undo, and no-op gestures drop their snapshot. Solid. (Missing only redo — see P4.)

---

## Polish backlog, ranked by "makes the timeline correct"

| P | Item | The actual mobile bug/gap | OpenCut pattern to borrow | Effort |
|---|---|---|---|---|
| **P1** | **Head-trim (in-point trimming)** | `trimItem` only shrinks the **tail**; you cannot left-trim a clip on mobile at all | every element has `trimStart`+`trimEnd`; left-trim slides `from`+`offsetFrames` together | S–M |
| **P2** | **Single-clamped-delta resize math** | trim derives fields ad hoc; linked-partner + rounding drift risk | `group-resize/compute-resize.ts` — one snapped delta, derive all fields from it | S |
| **P3** | **Overlap-safe drop/move** | `dragClip.ts` `push()`es a moved clip into a lane with **no overlap check** → clips silently overlap | `canPlaceTimeSpansOnTrack` (interval overlap) + `resolveTrackPlacement` (find lane / spawn new) | S–M |
| **P4** | **Redo** | `useTimelineHistory` is undo-only | Command redo stack (or just a redo array here) | S |
| **P5** | **Ripple mode** | only gap-delete-closes-up; no ripple-delete/ripple-trim | `ripple/*` pure `Tracks→Tracks`, shifts sorted **descending** by time | S–M |
| **P6** | **Stale preview-seek guard** | throttled `previewSeekTo` during a scrub can land a stale frame after release | `playbackSessionId` / seek-generation counter invalidates in-flight seeks | S |

---

## Details

### P1 — Head-trim / in-point trimming  *(biggest correctness/parity gap)*
`ops/edit.ts::trimItem` only clamps `durationInFrames` (tail). There is **no operation to drag the
left edge** — mobile users can shorten a clip from the end but not the start, and can't reveal earlier
source frames. Web has this; mobile doesn't.

**Borrow:** OpenCut models every clip with both `trimStart` and `trimEnd`. Our equivalent already
exists in the data model (`offsetFrames` = source in-point, `from` = timeline start). A head-trim by
`delta` frames is:
```
from            += delta
offsetFrames    += delta      // reveal/hide earlier source
durationInFrames-= delta
// clamp so offsetFrames >= 0 and durationInFrames >= 1
```
Branch on `isImageItem` (images have no source in-point → `offsetFrames` stays 0, uncapped resize),
exactly like `trimItem`'s `capOf`. Add a left trim-handle in `TimelineItem`, feed it through this op.

### P2 — Single-clamped-delta resize (do P1 *on top of this*)
OpenCut's `compute-resize.ts` computes **one** clamped, frame-snapped `deltaTime` for the drag
(bounded by neighbor gaps + source extent), then derives every field from that single delta so the
invariant `offsetFrames + durationInFrames (+ trimEnd) == sourceDuration` stays exact and **no
per-field rounding drift** accumulates across linked partners. Our `trimItem` recomputes each field
independently and re-clamps linked partners separately — the class of bug behind "undo-trim-from-start
stretched the clip" (which is in OpenCut's *own* changelog as a fix). Refactor trim/head-trim to:
snap the delta once → derive `from`/`offsetFrames`/`durationInFrames` → apply to target and linked
partners from the *same* delta.

### P3 — Overlap-safe placement on drag
`ops/dragClip.ts` resolves a drop as `move | lane | new-track` and just `push`es the item into the
destination `items[]`. There is **no interval-overlap guard**, so a cross-track move onto an occupied
region produces overlapping clips on one lane (undefined render/playback order). Borrow OpenCut's two
pure helpers:
- `canPlaceTimeSpansOnTrack(track, span, excludeId)` — the standard test `start < otherEnd && end >
  otherStart`.
- `resolveTrackPlacement(...)` — strategy machine (`firstAvailable | preferIndex | alwaysNew`): if the
  target lane is occupied, find a compatible lane or spawn a new one. Cheap, pure, drops into `ops/`.

### P4 — Redo
`useTimelineHistory` keeps a JSON undo stack but no redo. Add a `redoStack` that `undo()` pushes onto
and a new `redo()` pops from; clear it on any fresh `mutate`. Small, self-contained, no model change.

### P5 — Ripple mode
Today only `ops/gaps.ts` closes a gap on delete. A real ripple toggle (delete/trim shifts everything
after it left) is OpenCut's `ripple/*`: diff before/after to find freed spans → shift every element
with `start >= afterTime` by `shiftAmount`, **adjustments sorted descending by time so shifts compose
without clobbering** (that ordering is the non-obvious correctness bit). Pure `Timeline → Timeline`,
lands in `ops/` behind a `ripple` flag next to the existing `magnet` flag.

### P6 — Stale preview-seek guard
`useEditorPlayback` already guards the rAF loop against a stale `applyFrame`, and re-issues the
standby pre-seek "until it takes" — but the throttled `previewSeekTo` used during a timeline scrub has
no invalidation token, so a late async seek can paint a frame from an earlier scrub position after the
finger lifts. Borrow OpenCut's `playbackSessionId` idea: a monotonic counter bumped on every
seek/scrub-start; ignore any async seek result whose token != current. Cheap insurance for fast
scrubbing.

---

## Parked (features, not "make it correct" polish)
- **Keyframes → Ken Burns on stills.** OpenCut's keyframe blueprint (registry → resolve-at-time → UI
  hooks) is clean, and an animatic of stills is the textbook pan/zoom case — but it's a *feature*, not
  timeline correctness. Revisit after P1–P6.
- **Captions** (OpenCut's SRT/ASS parsers + transcription) — feature, later.

## Suggested order
P2 (delta math) → P1 (head-trim, built on it) → P3 (overlap guard) → P4 (redo) → P5 (ripple) →
P6 (seek token). P1–P4 are the ones that make the mobile timeline *feel finished*.
