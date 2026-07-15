// Magnet snapping — the pure geometry behind "drag a clip and it sticks to
// nearby edges". Verbatim port of web-editor/src/modules/timeline/ops/snap.js.
//
// The threshold is a fixed pixel radius converted to frames so the pull feels
// the same at any zoom: `thresh = max(1, (SNAP_PX / pxPerSec) * fps)`.
import type { Timeline } from "@/editor/core/timeline";

// Collect snap targets: 0, an extra point (the playhead), and every clip edge
// across all tracks, excluding the dragged clip + its partners.
export function snapTargets(
  tl: Timeline | null,
  extra: number | null | undefined,
  excludeIds?: Set<string>,
): number[] {
  const targets = [0];
  if (extra != null) targets.push(extra);
  for (const t of tl?.tracks || []) {
    for (const it of t.items || []) {
      if (excludeIds && excludeIds.has(it.id)) continue;
      const s = it.from || 0;
      targets.push(s, s + (it.durationInFrames || 0));
    }
  }
  return targets;
}

// Snap a clip's START or END edge to the nearest target within `thresh`.
// Returns { from, at } or null.
export function computeSnap(
  targets: number[],
  proposedFrom: number,
  dur: number,
  thresh: number,
): { from: number; at: number } | null {
  const start = proposedFrom;
  const end = proposedFrom + dur;
  let best: { from: number; at: number; dist: number } | null = null;
  for (const target of targets) {
    const ds = Math.abs(start - target);
    if (ds <= thresh && (!best || ds < best.dist)) best = { from: target, at: target, dist: ds };
    const de = Math.abs(end - target);
    if (de <= thresh && (!best || de < best.dist)) best = { from: target - dur, at: target, dist: de };
  }
  if (!best) return null;
  return { from: Math.max(0, Math.round(best.from)), at: best.at };
}
