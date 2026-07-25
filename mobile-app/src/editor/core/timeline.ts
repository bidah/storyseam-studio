// Shared timeline model + helpers — the React Native port of the web editor's
// `core/timeline.js`. This file is a VERBATIM port of the web model: it is the
// single source of truth shared by both editors, so the shapes and helper
// semantics MUST stay identical. Web reference:
//   web-editor/src/core/timeline.js  →  /docs/modules/timeline
//   this file                        →  /docs/react-native/timeline
//
// A timeline is the editable representation of a "complete cut" — the ordered
// video clips plus the music bed, all measured in FRAMES at a fixed fps.
//
// Shape:
//   {
//     fps: 24, width: 1280, height: 720,
//     tracks: [
//       { id, name, type: "video", items: [ { id, src, from, durationInFrames, name, bundle } ] },
//       { id, name, type: "audio", items: [ { id, src, from, durationInFrames, name, volume,
//                                             fadeInFrames?, fadeOutFrames? } ] },
//     ],
//   }
// `from` / `durationInFrames` are integer frame counts. Items may carry a
// `linkId`: items sharing one are LINKED (e.g. a video clip and its separated
// audio) and move/trim/delete together.
//
// MEDIA KIND IS THE ITEM'S, NOT THE TRACK'S. A `type: "video"` track is the
// PICTURE lane; what each item on it actually is comes from `item.kind`:
//
//   kind?: "video" | "image"     // absent ⇒ "video" (every pre-animatic doc)
//
// A `kind: "image"` item is a storyboard still held on screen for
// `durationInFrames` — the animatic's picture (worker/src/routes/animatic.js
// builds it). Stills and videos are PEERS on one picture lane on purpose: a
// still is a placeholder for that shot's video, and the upgrade (generate the
// video, drop it in the same slot, keep the timing) must not require moving
// tracks.
//
// Image items differ from video in ways this editor must respect:
//   • `sourceDurationInFrames` is ALWAYS absent — an image has no natural
//     length, so its duration is free (absent already means "uncapped resize"
//     to `trimItem`, which is exactly right).
//   • `src` may be `null` ⇒ a SLATE: a shot with no still generated yet. It is
//     an ordinary item (movable/trimmable) that renders as a labelled
//     placeholder, so a half-generated animatic keeps correct timing and shows
//     its holes instead of going black.
//   • It must never reach `expo-video` — the playback engine branches on kind.
// Image items carry `shot` + `stillFile` provenance (which shot's picture slot
// this is, and which take is on screen).
//
// The web's third image invariant — `offsetFrames` (source in-point) is always
// 0 — has no analogue here: this editor has no in-point trimming or split, so
// the model carries no `offsetFrames` at all.

export const FPS = 24;
export const WIDTH = 1280;
export const HEIGHT = 720;

export type TrackType = "video" | "audio";
export type MediaKind = "video" | "image";

/**
 * A single clip on a track. `src` on the web is a root-relative URL; on native
 * it is either a remote URL or a bundled `require(...)` module id resolved by
 * the backend's `mediaUrl`. It is `null` only on a SLATE (see above).
 * Everything else matches the web contract.
 */
export interface TimelineItem {
  id: string;
  src: string | null;
  name: string;
  from: number;
  durationInFrames: number;
  sourceDurationInFrames?: number;
  /**
   * SOURCE IN-POINT: the item plays source frames [offsetFrames, offsetFrames +
   * durationInFrames) — advanced on a split's right half / head-trim. ALWAYS
   * 0/absent on image items (no source timeline).
   */
  offsetFrames?: number;
  /** Absent ⇒ "video". See the media-kind note above. */
  kind?: MediaKind;
  /** Image provenance: the shot whose picture slot this is. */
  shot?: string;
  /** Image provenance: which storyboard take is on screen — null on a slate. */
  stillFile?: string | null;
  volume?: number;
  muted?: boolean;
  disabled?: boolean;
  flipH?: boolean;
  flipV?: boolean;
  /** Null (not absent) on animatic items whose shot matched no bundle. */
  bundle?: string | null;
  linkId?: string;
  // audio-only
  fadeInFrames?: number;
  fadeOutFrames?: number;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  items: TimelineItem[];
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  source?: { kind?: string; v?: number; file?: string; at?: number };
  tracks: Track[];
}

export const secToFrames = (sec: number, fps = FPS): number =>
  Math.max(1, Math.round((sec || 0) * fps));
export const framesToSec = (frames: number, fps = FPS): number => (frames || 0) / fps;

// --- media kind ---------------------------------------------------------
// One definition of "is this an image", used by the composition, the playback
// engine and the timeline strip — mirroring `isImageItem` in the web's
// src/editor/timeline.js and `isImage` in worker/src/routes/timeline.js. `kind`
// absent ⇒ video, so every saved doc reads correctly forever.
export const isImageItem = (item?: TimelineItem | null): boolean => item?.kind === "image";
// A slate is an image item with no still yet — it renders as a placeholder.
export const isSlateItem = (item?: TimelineItem | null): boolean =>
  isImageItem(item) && !item?.src;

// Enforce the image invariants on one item (idempotent). Applied when a
// timeline is LOADED (`withSourceDurations`), so an agent-written or
// hand-edited doc can't produce an image that claims a source length it does
// not have. This is the net under the ops, not their enforcement.
export function normalizeItemKind(item: TimelineItem): TimelineItem {
  if (!isImageItem(item)) return item;
  delete item.sourceDurationInFrames;
  return item;
}

// Longest track end → composition length (never 0).
export function timelineDuration(timeline: Timeline | null): {
  durationInFrames: number;
  fps: number;
} {
  const fps = timeline?.fps || FPS;
  let end = 0;
  for (const track of timeline?.tracks || []) {
    for (const it of track.items || []) {
      end = Math.max(end, (it.from || 0) + (it.durationInFrames || 0));
    }
  }
  return { durationInFrames: Math.max(1, Math.round(end)), fps };
}

export function emptyTimeline(): Timeline {
  return {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    tracks: [
      { id: "video", name: "Video", type: "video", items: [] },
      { id: "music", name: "Music", type: "audio", items: [] },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Pure timeline helpers shared across the editor modules. These read  *
 * the model but never mutate it (callers clone first). Feature-       *
 * specific mutations live in modules/timeline/ops/*.                  *
 * ------------------------------------------------------------------ */

// Which video clip is showing at composition frame `f`: the first (topmost —
// earlier tracks win z-order) non-disabled video item whose span covers `f`.
export function itemAtFrame(timeline: Timeline | null, f: number): TimelineItem | null {
  if (!timeline) return null;
  for (const track of timeline.tracks || []) {
    if (track.type !== "video") continue;
    for (const item of track.items || []) {
      if (item.disabled) continue;
      if (f >= item.from && f < item.from + (item.durationInFrames || 0)) return item;
    }
  }
  return null;
}

// Every item sharing `linkId` across all tracks (the "link group").
export function linkGroupOf(tl: Timeline | null, linkId?: string): TimelineItem[] {
  const out: TimelineItem[] = [];
  if (!tl || !linkId) return out;
  for (const t of tl.tracks || [])
    for (const it of t.items || []) if (it.linkId === linkId) out.push(it);
  return out;
}

// Empty spans before/between a track's clips (not trailing space after last).
export function gapsFor(track: Track): { from: number; to: number }[] {
  const items = [...(track.items || [])].sort((a, b) => a.from - b.from);
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const it of items) {
    if (it.from > cursor + 0.5) gaps.push({ from: cursor, to: it.from });
    cursor = Math.max(cursor, it.from + it.durationInFrames);
  }
  return gaps;
}

// Backfill each video clip's natural source length so it can't be stretched
// past its real duration — and hold the image invariants (see the media-kind
// note at the top) for everything loaded into the editor.
//
// Images are SKIPPED, not backfilled: a still has no natural length, so capping
// it at whatever duration the animatic happened to give it would make the one
// resize the user actually wants — holding a picture longer — impossible.
export function withSourceDurations(tl: Timeline | null): Timeline | null {
  if (!tl) return tl;
  for (const t of tl.tracks || []) {
    if (t.type === "video") {
      for (const it of t.items) {
        if (isImageItem(it)) {
          normalizeItemKind(it);
          continue;
        }
        if (it.sourceDurationInFrames == null) it.sourceDurationInFrames = it.durationInFrames;
      }
    }
  }
  return tl;
}

// Build a fresh empty track of the given media type with a non-colliding id.
export function makeTrack(tl: Timeline, type: TrackType): Track {
  const isAudio = type === "audio";
  const base = isAudio ? "music" : "video";
  const ids = new Set(tl.tracks.map((t) => t.id));
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return { id: `${base}-${n}`, name: `${isAudio ? "Music" : "Video"} ${n}`, type, items: [] };
}
