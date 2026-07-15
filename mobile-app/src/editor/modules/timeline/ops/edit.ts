// Move / trim — the pure timeline mutations behind dragging a clip along its
// lane and dragging its right trim handle. On the web these were done inline in
// the Editor's pointer handlers (with `computeSnap`); here they are named pure
// ops so the RN gesture layer stays a thin caller, matching the module's
// "pure ops separated from UI" principle. Both mutate `tl` in place and honor
// links (a moved/trimmed clip drags its linked partners along).
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { linkGroupOf, type Timeline } from "@/editor/core/timeline";

// Move a clip (and its whole link group) so the clip starts at `newFrom`.
// The link group shifts by the same delta; nothing goes below 0.
export function moveItem(tl: Timeline, id: string, newFrom: number): Timeline {
  let target = null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      target = it;
      break;
    }
  }
  if (!target) return tl;
  const from = Math.max(0, Math.round(newFrom));
  const delta = from - target.from;
  if (delta === 0) return tl;
  if (target.linkId) {
    // Clamp so the earliest group member never crosses 0.
    const group = linkGroupOf(tl, target.linkId);
    let d = delta;
    for (const g of group) d = Math.max(d, -g.from);
    for (const g of group) g.from = Math.max(0, g.from + d);
  } else {
    target.from = from;
  }
  return tl;
}

// Trim a clip's right edge to `newDuration` frames, clamped to
// [1, sourceDurationInFrames]. Linked partners sharing the start match length.
export function trimItem(tl: Timeline, id: string, newDuration: number): Timeline {
  let target = null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      target = it;
      break;
    }
  }
  if (!target) return tl;
  const cap = target.sourceDurationInFrames || Infinity;
  const dur = Math.max(1, Math.min(cap, Math.round(newDuration)));
  const prev = target.durationInFrames;
  target.durationInFrames = dur;
  if (target.linkId) {
    for (const g of linkGroupOf(tl, target.linkId)) {
      if (g.id !== target.id && g.durationInFrames === prev && g.from === target.from) {
        g.durationInFrames = Math.max(1, Math.min(g.sourceDurationInFrames || Infinity, dur));
      }
    }
  }
  return tl;
}
