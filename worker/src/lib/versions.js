// Bounded "sent to the editor" version lists (`db.radioVersions`,
// `db.animaticVersions`) inside the shared `selections` doc.
//
// Each entry stores a WHOLE timeline inline, so an unbounded list grows the doc
// by a full timeline on every build — and `selections.json` is read and
// rewritten by nearly every route. These lists are a convenience history ("load
// the radio version I built an hour ago"), not an archive: the working timeline
// lives at `db.editorTimeline` and finished work lives in `db.cutHistory`. So we
// keep the most recent few and drop the rest.
export const MAX_VERSIONS = 10;

// The next version number. Derived from the highest `v` ever seen, NOT from
// `list.length` — pruning shrinks the list, so length-based numbering would
// recycle `v` and collide with a version a user still has open.
export function nextVersion(list) {
  let max = 0;
  for (const e of list || []) max = Math.max(max, Number(e?.v) || 0);
  return max + 1;
}

// Append `entry` and prune the oldest beyond `max`. Returns the pruned count so
// the caller can report it.
export function appendCapped(list, entry, max = MAX_VERSIONS) {
  list.push(entry);
  const excess = list.length - max;
  if (excess > 0) list.splice(0, excess);
  return { pruned: Math.max(0, excess) };
}
