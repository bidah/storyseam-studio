// Repack a track's items end-to-end (gapless) in the given order, dragging each
// moved item's LINKED partners (on OTHER tracks) along by the same delta.
// Verbatim port of web-editor/src/modules/timeline/ops/repack.js. Mutates in place.
import type { Timeline, Track, TimelineItem } from "@/editor/core/timeline";

export function repackWithLinks(tl: Timeline, track: Track, ordered: TimelineItem[]): Timeline {
  const deltas = new Map<string, number>(); // linkId → frame delta of its moved member
  let cur = 0;
  for (const it of ordered) {
    if (it.linkId) deltas.set(it.linkId, cur - it.from);
    it.from = cur;
    cur += it.durationInFrames;
  }
  track.items = ordered;
  if (!deltas.size) return tl;
  for (const t of tl.tracks) {
    if (t === track) continue;
    for (const it of t.items) {
      if (it.linkId && deltas.has(it.linkId))
        it.from = Math.max(0, it.from + (deltas.get(it.linkId) as number));
    }
  }
  return tl;
}
