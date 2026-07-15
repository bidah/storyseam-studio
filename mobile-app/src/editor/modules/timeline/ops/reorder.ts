// Reorder a video clip left/right in playback order, then close gaps. Verbatim
// port of web-editor/src/modules/timeline/ops/reorder.js. Honors links.
import type { Timeline } from "@/editor/core/timeline";
import { repackWithLinks } from "./repack";

export function reorderVideo(tl: Timeline, id: string, dir: number): Timeline {
  const t = tl.tracks.find((x) => x.items.some((it) => it.id === id));
  if (!t) return tl;
  const items = t.items.slice().sort((a, b) => a.from - b.from);
  const i = items.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return tl;
  [items[i], items[j]] = [items[j], items[i]];
  repackWithLinks(tl, t, items);
  return tl;
}
