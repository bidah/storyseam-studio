// Gap operations — the "remove gap" / "close gaps" feature. Verbatim port of
// web-editor/src/modules/timeline/ops/gaps.js. Both honor item links and mutate
// `tl` in place. Read selectable gaps for a track with `gapsFor(track)`.
import type { Timeline } from "@/editor/core/timeline";
import { repackWithLinks } from "./repack";

// Delete just this gap: pull every later clip on the track left by its width,
// and pull each shifted clip's linked partners (on other tracks) along.
export function removeGap(tl: Timeline, trackId: string, gap: { from: number; to: number }): Timeline {
  const w = gap.to - gap.from;
  const t = tl.tracks.find((x) => x.id === trackId);
  if (!t) return tl;
  const shifted = new Set<string>(); // linkIds of shifted clips
  for (const it of t.items) {
    if (it.from >= gap.to - 0.5) {
      it.from -= w;
      if (it.linkId) shifted.add(it.linkId);
    }
  }
  if (shifted.size) {
    for (const ot of tl.tracks) {
      if (ot === t) continue;
      for (const it of ot.items) {
        if (it.linkId && shifted.has(it.linkId)) it.from = Math.max(0, it.from - w);
      }
    }
  }
  return tl;
}

// Lay every video channel's clips end-to-end (gapless) in current start order.
export function closeGapsAll(tl: Timeline): Timeline {
  for (const t of tl.tracks) {
    if (t.type !== "video") continue;
    repackWithLinks(tl, t, t.items.slice().sort((a, b) => a.from - b.from));
  }
  return tl;
}
