// Link operations. Items sharing a `linkId` are LINKED and move/trim/delete
// together. Verbatim port of web-editor/src/modules/timeline/ops/link.js.
import { linkGroupOf, type Timeline } from "@/editor/core/timeline";

// Separate a video clip's audio onto the first audio track as a LINKED audio
// item playing the same source file, and mute the video card.
export function detachAudio(tl: Timeline, id: string): Timeline {
  let vid = null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      vid = it;
      break;
    }
  }
  if (!vid || vid.linkId) return tl;
  let at = tl.tracks.find((t) => t.type === "audio");
  if (!at) {
    at = { id: "music", name: "Music", type: "audio", items: [] };
    tl.tracks.push(at);
  }
  const linkId = `link_${id}`;
  at.items.push({
    id: `${id}_audio`,
    src: vid.src,
    name: vid.name,
    from: vid.from,
    durationInFrames: vid.durationInFrames,
    sourceDurationInFrames: vid.sourceDurationInFrames || vid.durationInFrames,
    volume: vid.muted ? 0 : vid.volume ?? 1,
    linkId,
  });
  vid.linkId = linkId;
  vid.muted = true;
  return tl;
}

// Link EXACTLY the selected clips into one fresh group.
export function linkSelected(tl: Timeline, ids: string[]): Timeline {
  const set = new Set(ids);
  if (set.size < 2) return tl;
  const members = [];
  for (const t of tl.tracks) for (const it of t.items) if (set.has(it.id)) members.push(it);
  if (members.length < 2) return tl;
  const linkId = `link_${Date.now()}_${members[0].id}`;
  for (const it of members) it.linkId = linkId;
  // Dissolve any old group that lost its partners to this one.
  const counts = new Map<string, number>();
  for (const t of tl.tracks)
    for (const it of t.items) if (it.linkId) counts.set(it.linkId, (counts.get(it.linkId) || 0) + 1);
  for (const t of tl.tracks)
    for (const it of t.items) if (it.linkId && (counts.get(it.linkId) as number) < 2) delete it.linkId;
  return tl;
}

// Unlink every selected clip.
export function unlinkSelected(tl: Timeline, ids: string[]): Timeline {
  const set = new Set(ids);
  if (!set.size) return tl;
  const linkIds = new Set<string>();
  for (const t of tl.tracks)
    for (const it of t.items) if (set.has(it.id) && it.linkId) linkIds.add(it.linkId);
  if (!linkIds.size) return tl;
  for (const t of tl.tracks)
    for (const it of t.items) if (it.linkId && linkIds.has(it.linkId)) delete it.linkId;
  return tl;
}

// Dissolve a single clip's link group.
export function unlinkItem(tl: Timeline, id: string): Timeline {
  let linkId: string | undefined;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) {
      linkId = it.linkId;
      break;
    }
  }
  if (linkId) for (const it of linkGroupOf(tl, linkId)) delete it.linkId;
  return tl;
}
