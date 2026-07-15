// Drop operations — the timeline mutations behind dragging a clip to another
// channel (applyVerticalDrop) and dropping a pool clip onto the timeline
// (addPoolClip). Verbatim port of web-editor/src/modules/timeline/ops/dragClip.js.
// The hit-testing that produces a `drop` descriptor lives in the Timeline; these
// functions are the pure half. Both mutate `tl` in place and return it.
//
// A `drop` is:
//   { type: "move", trackId }              – onto an existing channel
//   { type: "new", ref, side, from? }      – into a new channel before/after `ref`
//   { type: "lane", trackId, from }        – (pool drop) onto an existing lane
import { makeTrack, type Timeline, type TrackType, type TimelineItem } from "@/editor/core/timeline";

export type Drop =
  | { type: "move"; trackId: string }
  | { type: "new"; ref: string; side: "before" | "after"; from?: number }
  | { type: "lane"; trackId: string; from: number };

export interface PoolItem {
  id: string;
  mediaType: "video" | "audio";
  name: string;
  src: string;
  bundle?: string;
}

// Commit a vertical drag: pull the item out of its channel and either move it
// onto an existing channel or into a brand-new one inserted at `drop.ref/side`.
export function applyVerticalDrop(tl: Timeline, id: string, drop: Drop, type: TrackType): Timeline {
  let moved: TimelineItem | null = null;
  let srcTrack = null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      moved = it;
      srcTrack = t;
      break;
    }
  }
  if (!moved || !srcTrack) return tl;
  if (drop.type === "move") {
    const dest = tl.tracks.find((t) => t.id === drop.trackId);
    if (!dest || dest === srcTrack) return tl;
    srcTrack.items = srcTrack.items.filter((x) => x.id !== id);
    dest.items.push(moved);
  } else if (drop.type === "new") {
    srcTrack.items = srcTrack.items.filter((x) => x.id !== id);
    const nt = makeTrack(tl, type);
    nt.items.push(moved);
    const i = tl.tracks.findIndex((t) => t.id === drop.ref);
    const at = i < 0 ? tl.tracks.length : drop.side === "after" ? i + 1 : i;
    tl.tracks.splice(at, 0, nt);
  }
  // Drop any now-empty channel we created earlier; keep the base two always.
  tl.tracks = tl.tracks.filter((t) => t.items.length > 0 || t.id === "video" || t.id === "music");
  return tl;
}

// Drop a pool clip as a fresh timeline item carrying the media's natural length.
// A VIDEO drop separates its audio onto the first audio track (linked, muted
// video card). `newId` is supplied by the caller so it can select the new clip.
export function addPoolClip(
  tl: Timeline,
  item: PoolItem,
  drop: Drop,
  durationSec: number,
  fps: number,
  newId: string,
): Timeline {
  const type: TrackType = item.mediaType === "audio" ? "audio" : "video";
  const dur = Math.max(1, Math.round((durationSec || 3) * (tl.fps || fps)));
  const isVideo = type === "video";
  const linkId = isVideo ? `link_${newId}` : undefined;
  const newItem: TimelineItem = {
    id: newId,
    src: item.src,
    name: item.name,
    from: Math.max(0, Math.round((drop as any).from ?? 0)),
    durationInFrames: dur,
    sourceDurationInFrames: dur,
    volume: 1,
    ...(isVideo ? { muted: true, linkId } : {}),
    ...(item.bundle ? { bundle: item.bundle } : {}),
  };
  if (drop.type === "new") {
    const nt = makeTrack(tl, type);
    nt.items.push(newItem);
    const i = tl.tracks.findIndex((t) => t.id === drop.ref);
    const at = i < 0 ? tl.tracks.length : drop.side === "after" ? i + 1 : i;
    tl.tracks.splice(at, 0, nt);
  } else {
    const t = tl.tracks.find((x) => x.id === (drop as any).trackId);
    if (!t) return tl;
    t.items.push(newItem);
  }
  if (isVideo) {
    let at = tl.tracks.find((t) => t.type === "audio");
    if (!at) {
      at = { id: "music", name: "Music", type: "audio", items: [] };
      tl.tracks.push(at);
    }
    at.items.push({
      id: `${newId}_audio`,
      src: item.src,
      name: item.name,
      from: newItem.from,
      durationInFrames: dur,
      sourceDurationInFrames: dur,
      volume: 1,
      linkId,
    });
  }
  return tl;
}
