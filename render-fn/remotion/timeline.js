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
