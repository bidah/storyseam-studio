// VENDORED from shot-studio/src/editor/timeline.js — keep in sync via `npm run sync` (scripts/sync-composition.mjs). Do not edit by hand.

// Shared timeline model + helpers for the Remotion editor.
//
// A timeline is the editable representation of a "complete cut" — the ordered
// video clips plus the music bed, all measured in FRAMES at a fixed fps. It is
// the single source of truth shared by three consumers:
//   • the Remotion <Player> composition (src/editor/Composition.jsx)
//   • the Editor tab timeline UI          (src/components/Editor.jsx)
//   • the chat agent                      (agent/tools/*_timeline.ts → /api/timeline)
//
// Shape:
//   {
//     fps: 24, width: 1280, height: 720,
//     name?: "Trailer cut",   // the author's label, shown + editable in the
//                             // Editor header (POST /api/timeline/new sets it,
//                             // the `rename` op changes it). Purely editorial —
//                             // nothing in the composition reads it.
//     tracks: [
//       { id, name, type: "video", items: [ { id, src, from, durationInFrames, offsetFrames?, name, bundle } ] },
//       { id, name, type: "audio", items: [ { id, src, from, durationInFrames, offsetFrames?, name, volume,
//                                             fadeInFrames?, fadeOutFrames? } ] },
//     ],
//   }
//
// MEDIA KIND IS THE ITEM'S, NOT THE TRACK'S. A `type: "video"` track is the
// PICTURE lane; what each item on it actually is comes from `item.kind`:
//
//   kind?: "video" | "image"     // absent ⇒ "video" (every pre-animatic doc)
//
// A `kind: "image"` item is a storyboard still held on screen for
// `durationInFrames` — the animatic's picture (see worker/src/routes/animatic.js).
// Stills and videos are PEERS on one picture lane on purpose: a still is a
// placeholder for that shot's video, and the upgrade (generate the video, drop
// it in the same slot, keep the timing) must not require moving tracks.
//
// Image items differ from video in three ways, and each is an invariant some
// existing code path would otherwise violate:
//   • `sourceDurationInFrames` is ALWAYS absent — an image has no natural
//     length, so its duration is free. (Absent already means "uncapped resize",
//     which is exactly right, so no new clamp logic exists for images.)
//   • `offsetFrames` is ALWAYS 0/absent and IGNORED — there is no source
//     timeline to seek into. Head-trim moves `from` only; a split copies the
//     src and leaves both halves at 0.
//   • `src` may be `null` ⇒ a SLATE: a shot with no still generated yet. It is
//     an ordinary item (movable/trimmable/splittable) that renders as a labelled
//     placeholder card, so a half-generated animatic keeps correct timing and
//     shows its holes instead of going black.
// Image items carry `shot` + `stillFile` provenance (which shot's picture slot
// this is, and which take is on screen) so the Editor can regenerate/swap takes.
//
// `from` / `durationInFrames` are integer frame counts. `offsetFrames` is the
// SOURCE IN-POINT: the item plays source frames [offsetFrames, offsetFrames +
// durationInFrames) at timeline position [from, from + durationInFrames).
// Absent means 0 (play from the start of the source — every pre-offset doc).
// Invariant when the source length is known: offsetFrames + durationInFrames
// ≤ sourceDurationInFrames. Splitting a clip at the playhead produces a right
// half whose offsetFrames is advanced by the left half's length.
// `src` is a root-relative
// URL (e.g. "/gen/MS-01.mp4") resolved against the app origin. Audio items may
// carry `fadeInFrames` / `fadeOutFrames` — linear volume ramps at the clip's
// head/tail, set by dragging the fade handles on the editor's timeline cards.
// Items may carry a `linkId`: items sharing one are LINKED (e.g. a video clip
// and its separated audio) and move/trim/delete together while the editor's
// "Link" toggle is on. An audio item whose `src` is a video file plays that
// file's audio track (how separated clip audio works).
//
// `speed` is the item's playback RATE (retime): 2 plays the source twice as
// fast, 0.5 at half speed. Absent ⇒ 1. It is the only field that breaks the
// 1:1 frame mapping between the source and the timeline, so every piece of
// in-point math multiplies by it — the item plays source frames
//   [offsetFrames, offsetFrames + durationInFrames × speed)
// across timeline frames [from, from + durationInFrames). Remotion applies the
// two in that exact order (trimBefore first, then playbackRate, fixed since
// v4.0.141), so passing both straight through renders what the timeline draws.
// Images have no source timeline and therefore no speed.

export const FPS = 24;
export const WIDTH = 1280;
export const HEIGHT = 720;

export const secToFrames = (sec, fps = FPS) => Math.max(1, Math.round((sec || 0) * fps));
export const framesToSec = (frames, fps = FPS) => (frames || 0) / fps;

// --- media kind ---------------------------------------------------------
// One definition of "is this an image", used by the compositions, the Editor,
// and (mirrored) the worker. `kind` absent ⇒ video, so every saved doc reads
// correctly forever.
export const isImageItem = (item) => item?.kind === "image";
// A slate is an image item with no still yet — it renders as a placeholder.
export const isSlateItem = (item) => isImageItem(item) && !item.src;

// --- speed / retime ------------------------------------------------------
// One definition of the retime math, shared by the compositions, the Editor and
// (mirrored) the worker. Everything reads the speed through `itemSpeed`, so a
// doc written before the field existed — or one carrying a garbage value —
// plays at 1× instead of dividing by zero.
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 10;
export const clampSpeed = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(n * 1000) / 1000));
};
export const itemSpeed = (item) => (item?.speed == null ? 1 : clampSpeed(item.speed));

// Source frames an item consumes: its timeline length × speed. This is the
// quantity a retime PRESERVES — changing speed re-times the same piece of
// media, it doesn't reach for more of it.
export const sourceSpanOf = (item) =>
  Math.max(1, Math.round((item?.durationInFrames || 0) * itemSpeed(item)));

// Longest timeline length the remaining source allows at `speed`. Infinity when
// the item has no source length to run out of (an image, or a clip saved before
// `sourceDurationInFrames` existed) — absent already means "uncapped resize".
export const maxDurationOf = (item, speed = itemSpeed(item)) => {
  const src = item?.sourceDurationInFrames;
  if (!src || isImageItem(item)) return Infinity;
  return Math.max(1, Math.floor((src - (item.offsetFrames || 0)) / speed));
};

// Timeline length that plays `span` source frames at `speed`.
export const retimedDuration = (span, speed) => Math.max(1, Math.round(span / clampSpeed(speed)));

// Enforce the image invariants on one item (idempotent). Applied when a timeline
// is LOADED (`withSourceDurations` in Editor.jsx), so a hand-edited or
// agent-written doc can't produce an image that tries to seek into a source it
// doesn't have. The ops that could violate them (split, head-trim, insert,
// replace) each hold the invariant themselves, on both the client and the worker
// — this is the net under them, not their enforcement.
export function normalizeItemKind(item) {
  if (!isImageItem(item)) return item;
  item.offsetFrames = 0;
  delete item.sourceDurationInFrames;
  // A still has no source timeline to play faster or slower — its length IS
  // its duration, which the trim handles already set.
  delete item.speed;
  return item;
}

// Longest track end → composition length (never 0, Remotion needs >= 1).
export function timelineDuration(timeline) {
  const fps = timeline?.fps || FPS;
  let end = 0;
  for (const track of timeline?.tracks || []) {
    for (const it of track.items || []) {
      end = Math.max(end, (it.from || 0) + (it.durationInFrames || 0));
    }
  }
  return { durationInFrames: Math.max(1, Math.round(end)), fps };
}

export function emptyTimeline() {
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
