# Timeline module (React Native)

The editable track surface and every operation that mutates it. The **pure ops**
are ported verbatim from the web editor; the **UI + gestures** are a native rewrite
that runs on the UI thread via Reanimated + Gesture Handler. The timeline data
model itself (the single source of truth) is `@/editor/core/timeline`.

> Web counterpart: `web-editor/src/modules/timeline` · docs: `/docs/react-native/timeline`

The interaction model follows mobile NLEs (CapCut / TikTok): a **fixed center
playhead** with the filmstrip scrolling under it (scroll = scrub), **pinch** to
zoom, **long-press + pan** to move a clip, a **right-edge handle** to trim, and
**double-tap** to open the inspector.

## Components & hooks

| Export | What it is |
|---|---|
| `Timeline` | the scrolling surface: fixed center playhead, ruler, lanes, pinch-zoom, scrub gesture |
| `TimelineItem` | one clip/music card: filmstrip / waveform, label, link/mute badges, trim handle |
| `Waveform` | SVG waveform bars + fade envelope for an audio card (same API as web's canvas version) |
| `useTimelineHistory({ onUndo })` | owns `timeline` state, the undo stack, the dirty flag, and gesture bracketing (a whole drag = one undo) |
| `LANE_H`, `MAX_VISIBLE_LANES`, `SNAP_PX`, `TICK_STEPS`, `pickTickStep`, `formatTimecode` | ruler + lane geometry |

`TimelineItem` props: `item, track, pxPerSec, fps, selected, linkHighlight,
multiCount, onSelect(id), onDragActive(active), onMove(id, newFrom, phase),
onTrim(id, newDuration, phase), onRequestActions(id)` — where `phase` is
`"begin" | "active" | "end"`.

## Operations (`ops/`)

Each is a **pure function over the timeline model** — it mutates the clone you pass
and returns it, so callers do `mutate(tl => op(tl, …))`. They honor item **links**
(a video clip and its separated audio move/trim/delete together).

| File | Exports | Feature |
|---|---|---|
| `ops/gaps.ts` | `removeGap(tl, trackId, gap)`, `closeGapsAll(tl)` | remove-gap / close-gaps |
| `ops/reorder.ts` | `reorderVideo(tl, id, dir)` | reorder clips |
| `ops/repack.ts` | `repackWithLinks(tl, track, ordered)` | shared gapless repack |
| `ops/link.ts` | `detachAudio`, `linkSelected`, `unlinkSelected`, `unlinkItem` | linking |
| `ops/remove.ts` | `removeItemFromTimeline(tl, id)`, `removeItems(tl, ids)` | delete |
| `ops/snap.ts` | `snapTargets(tl, extra, exclude)`, `computeSnap(targets, from, dur, thresh)` | magnet snapping |
| `ops/dragClip.ts` | `applyVerticalDrop(tl, id, drop, type)`, `addPoolClip(tl, item, drop, dur, fps, newId)` | move to channel / drop pool clip |
| `ops/edit.ts` | `moveItem(tl, id, newFrom)`, `trimItem(tl, id, newDuration)` | **RN-formalized** move / trim |

`gaps`, `reorder`, `repack`, `link`, `remove`, `snap`, and `dragClip` are ported
**verbatim** from web. `edit.ts` (`moveItem` / `trimItem`) is the one addition: on
the web these ran inline in the Editor's pointer handlers, so they're named pure ops
here to keep the Gesture Handler layer a thin caller.

## The seam

The gesture recognizers live on the UI thread and report intent back via
`runOnJS`; the model only changes through `useTimelineHistory.mutate(fn)`, which
clones, applies a pure op, and marks dirty. Undo is bracketed per gesture —
`beginGesture()` snapshots once and `endGesture()` (called on `Gesture.onEnd`)
closes it, so a whole drag is a single undo.
