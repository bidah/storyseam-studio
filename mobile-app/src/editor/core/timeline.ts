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

export const FPS = 24;
export const WIDTH = 1280;
export const HEIGHT = 720;

export type TrackType = "video" | "audio";

/**
 * A single clip on a track. `src` on the web is a root-relative URL; on native
 * it is either a remote URL or a bundled `require(...)` module id resolved by
 * the backend's `mediaUrl`. Everything else matches the web contract.
 */
export interface TimelineItem {
  id: string;
  src: string;
  name: string;
  from: number;
  durationInFrames: number;
  sourceDurationInFrames?: number;
  volume?: number;
  muted?: boolean;
  disabled?: boolean;
  flipH?: boolean;
  flipV?: boolean;
  bundle?: string;
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
// past its real duration.
export function withSourceDurations(tl: Timeline | null): Timeline | null {
  if (!tl) return tl;
  for (const t of tl.tracks || []) {
    if (t.type === "video") {
      for (const it of t.items) {
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
