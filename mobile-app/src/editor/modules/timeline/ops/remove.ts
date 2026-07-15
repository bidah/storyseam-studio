// Remove operations. Removing a linked clip takes its partners with it. Verbatim
// port of web-editor/src/modules/timeline/ops/remove.js.
import { linkGroupOf, type Timeline } from "@/editor/core/timeline";

// Remove one item and its link group.
export function removeItemFromTimeline(tl: Timeline, id: string): Timeline {
  let linkId: string | null = null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      linkId = it.linkId || null;
      break;
    }
  }
  for (const t of tl.tracks) {
    t.items = t.items.filter((x) => x.id !== id && (!linkId || x.linkId !== linkId));
  }
  return tl;
}

// Remove every id in the set, each pulling its link group along.
export function removeItems(tl: Timeline, ids: Iterable<string>): Timeline {
  const kill = new Set(ids);
  for (const t of tl.tracks) {
    for (const it of t.items) {
      if (kill.has(it.id) && it.linkId) for (const g of linkGroupOf(tl, it.linkId)) kill.add(g.id);
    }
  }
  for (const t of tl.tracks) t.items = t.items.filter((x) => !kill.has(x.id));
  return tl;
}
