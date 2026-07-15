// Playhead navigation — pure frame math for the transport controls. Verbatim
// port of web-editor/src/modules/playback/navigation.js. Keeping the math here
// makes "jump to next/prev cut" and "snap targets" testable without a player.
import type { Timeline } from "@/editor/core/timeline";

// Snap targets for the playhead: the timeline start (0) and every clip edge.
export function playheadTargets(timeline: Timeline | null): number[] {
  const out = [0];
  for (const t of timeline?.tracks || []) {
    for (const it of t.items || []) {
      const s = it.from || 0;
      out.push(s, s + (it.durationInFrames || 0));
    }
  }
  return out;
}

// The next cut boundary strictly after (dir>0) / before (dir<0) `frame`.
export function nextCut(timeline: Timeline | null, frame: number, dir: number): number | null {
  const edges = [...new Set(playheadTargets(timeline))].sort((a, b) => a - b);
  if (dir > 0) return edges.find((e) => e > frame + 0.5) ?? null;
  const before = edges.filter((e) => e < frame - 0.5);
  return before.length ? before[before.length - 1] : null;
}

// Clamp a frame into the composition's playable range [0, durationInFrames-1].
export function clampFrame(frame: number, durationInFrames: number): number {
  return Math.max(0, Math.min(durationInFrames - 1, Math.round(frame)));
}
