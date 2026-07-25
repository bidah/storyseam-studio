// Move / trim — the pure timeline mutations behind dragging a clip along its
// lane and dragging its right trim handle. On the web these were done inline in
// the Editor's pointer handlers (with `computeSnap`); here they are named pure
// ops so the RN gesture layer stays a thin caller, matching the module's
// "pure ops separated from UI" principle. Both mutate `tl` in place and honor
// links (a moved/trimmed clip drags its linked partners along).
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { isImageItem, linkGroupOf, type Timeline, type TimelineItem } from "@/editor/core/timeline";

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

// ---- split ("razor") — port of the web splitAtPlayhead (Editor.jsx) ---------
// Metadata-only: the right half is a NEW item whose `offsetFrames` (source
// in-point) is advanced by the left half's length, so both halves play their
// own piece of the same source file. Because `mutate`'s state updater must stay
// pure (it can replay), the split is two phases: `planSplit` computes the whole
// plan (right-half ids, fresh linkIds) from the CURRENT timeline, and
// `applySplit` deterministically applies it inside the updater.

export interface SplitPlan {
  frame: number;
  rightIds: string[];
  entries: {
    id: string;
    leftDur: number;
    rightId: string;
    rightLinkId: string | null;
  }[];
}

let splitSeq = 0;

// Targets: the selected clips strictly containing `frame` — or, when the
// selection doesn't apply, every non-disabled clip under it (razor across
// tracks). Linked partners split together. Returns null when nothing is cut.
export function planSplit(
  tl: Timeline,
  frame: number,
  selectedIds: ReadonlySet<string>,
  targetId: string | null = null,
): SplitPlan | null {
  const f = Math.round(frame);
  // Strictly inside: a cut at a clip edge would leave a zero-length half.
  const inside = (it: TimelineItem) =>
    f > (it.from || 0) && f < (it.from || 0) + (it.durationInFrames || 0);
  const all: TimelineItem[] = [];
  for (const t of tl.tracks || []) for (const it of t.items || []) all.push(it);
  let base: TimelineItem[];
  if (targetId != null) {
    base = all.filter((it) => it.id === targetId && inside(it));
  } else {
    base = all.filter((it) => selectedIds.has(it.id) && inside(it));
    if (!base.length) base = all.filter((it) => !it.disabled && inside(it));
  }
  // Linked partners (video ↔ its separated audio) split together.
  const byId = new Map(base.map((it) => [it.id, it]));
  for (const it of base) {
    if (it.linkId) for (const g of linkGroupOf(tl, it.linkId)) if (inside(g)) byId.set(g.id, g);
  }
  const targets = [...byId.values()];
  if (!targets.length) return null;
  // Right halves that came from one link group stay linked to EACH OTHER under
  // a fresh linkId; a lone right half is unlinked (keeping the old id would
  // tether it to the left group).
  const rightLinkFor = new Map<string, string>();
  for (const it of targets) {
    if (!it.linkId || rightLinkFor.has(it.linkId)) continue;
    if (targets.filter((x) => x.linkId === it.linkId).length >= 2) {
      rightLinkFor.set(it.linkId, `link_split_${Date.now()}_${rightLinkFor.size}`);
    }
  }
  const used = new Set(all.map((it) => it.id));
  const entries: SplitPlan["entries"] = [];
  for (const it of targets) {
    let rightId: string;
    do rightId = `${it.id}_r${++splitSeq}`;
    while (used.has(rightId));
    used.add(rightId);
    entries.push({
      id: it.id,
      leftDur: f - (it.from || 0),
      rightId,
      rightLinkId: it.linkId ? rightLinkFor.get(it.linkId) || null : null,
    });
  }
  return { frame: f, rightIds: entries.map((e) => e.rightId), entries };
}

export function applySplit(tl: Timeline, plan: SplitPlan): Timeline {
  const byId = new Map(plan.entries.map((e) => [e.id, e]));
  const f = plan.frame;
  for (const t of tl.tracks) {
    // Walk backwards so splicing the right half in never shifts unvisited items.
    for (let i = t.items.length - 1; i >= 0; i--) {
      const it = t.items[i];
      const p = byId.get(it.id);
      if (!p) continue;
      const right: TimelineItem = {
        ...it,
        id: p.rightId,
        from: f,
        durationInFrames: (it.durationInFrames || 0) - p.leftDur,
        // An image has no source timeline, so both halves keep in-point 0 and
        // simply hold the same still — splitting a still is a legitimate way to
        // hold one frame across a cut point.
        offsetFrames: isImageItem(it) ? 0 : (it.offsetFrames || 0) + p.leftDur,
      };
      delete right.fadeInFrames; // fade-in belongs to the left half
      if (p.rightLinkId) right.linkId = p.rightLinkId;
      else delete right.linkId;
      if (right.fadeOutFrames)
        right.fadeOutFrames = Math.min(right.fadeOutFrames, right.durationInFrames);
      it.durationInFrames = p.leftDur;
      if (it.fadeInFrames) it.fadeInFrames = Math.min(it.fadeInFrames, p.leftDur);
      delete it.fadeOutFrames; // fade-out belongs to the right half
      t.items.splice(i + 1, 0, right);
    }
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
  // The playable tail shrinks by the source in-point (a split's right half).
  const capOf = (it: TimelineItem) =>
    it.sourceDurationInFrames
      ? Math.max(1, it.sourceDurationInFrames - (it.offsetFrames || 0))
      : Infinity;
  const dur = Math.max(1, Math.min(capOf(target), Math.round(newDuration)));
  const prev = target.durationInFrames;
  target.durationInFrames = dur;
  if (target.linkId) {
    for (const g of linkGroupOf(tl, target.linkId)) {
      if (g.id !== target.id && g.durationInFrames === prev && g.from === target.from) {
        g.durationInFrames = Math.max(1, Math.min(capOf(g), dur));
      }
    }
  }
  return tl;
}
