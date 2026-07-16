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
