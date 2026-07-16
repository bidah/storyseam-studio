// Joining a SHOT to its storyboard STILL — the one lookup the animatic needs and
// the one that nothing else in the codebase does.
//
// The problem: stills are keyed `db.stills[bundleId][shotId]` (routes/
// storyboard.js), but a shot carries no bundle back-reference. The shot list is
// seeded by FLATTENING the episode manifest (routes/shotlist.js
// `rebuildShotlistFromEpisode`), so shot ids are one id space across the shot
// list, the manifest's `bundles[].shots[].id`, and the stills keys.
//
// Resolving shot → bundle has two possible sources, and they can DISAGREE:
//
//   1. The episode manifest (`state/<pid>/episode-manifest.json`) — a frozen
//      snapshot. AUTHORITATIVE, because `db.stills` was keyed from it: the
//      Episode tab only ever reaches stills from the manifest side.
//   2. `packPreview(shots)` — re-packs the CURRENT shot list and assigns
//      positional ids (MS-01…MS-NN). Tracks shot-list edits, but its ids drift
//      away from the manifest's the moment the list changes, so it is a
//      FALLBACK for shots the manifest has never heard of, never the primary.
//
// Callers get `source` per lookup so a divergence can be counted and reported
// rather than silently producing an all-slate animatic.
import { readDoc } from "../lib/docs.js";
import { listMediaSet } from "../lib/media.js";
import { packPreview } from "../lib/pack.js";

// Build the shot → bundle index. `shots` is the normalized shot list (for the
// packPreview fallback only).
export async function buildBundleIndex(env, pid, shots) {
  const manifest = await readDoc(env, pid, "episode-manifest", null);

  const fromManifest = new Map();
  for (const b of manifest?.bundles || []) {
    for (const s of b.shots || []) {
      // First bundle wins: a shot listed twice in the manifest is malformed, and
      // the stills were keyed to whichever bundle rendered it first.
      if (s?.id && b?.id && !fromManifest.has(s.id)) fromManifest.set(s.id, b.id);
    }
  }

  const fromPacks = new Map();
  for (const p of packPreview(shots || [])) {
    for (const id of p.shotIds || []) if (!fromPacks.has(id)) fromPacks.set(id, p.id);
  }

  return {
    hasManifest: fromManifest.size > 0,
    // → { bundle, source: "manifest" | "packs" } | null
    lookup(shotId) {
      const m = fromManifest.get(shotId);
      if (m) return { bundle: m, source: "manifest" };
      const p = fromPacks.get(shotId);
      if (p) return { bundle: p, source: "packs" };
      return null;
    },
  };
}

// Normalize a per-shot stills entry (array | single object | missing) to an
// array. Mirrors `asArray` in routes/storyboard.js — same tolerance for the
// pre-takes single-object shape.
const asArray = (entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []);

// Pick the take to put on screen: the explicitly selected one, else the newest
// (the list is newest-last). Only takes whose bytes actually exist in R2 are
// eligible, so a stale record yields a slate instead of a broken <Img>.
export function pickTake(list, presentFiles) {
  const usable = asArray(list).filter((v) => v?.file && presentFiles.has(v.file));
  if (!usable.length) return null;
  return usable.find((v) => v.selected) || usable[usable.length - 1];
}

// One-stop resolver for a whole build: the bundle index + the stills map + the
// single R2 listing they're validated against.
export async function readStillsContext(env, pid, shots) {
  const [index, db, files] = await Promise.all([
    buildBundleIndex(env, pid, shots),
    readDoc(env, pid, "selections", { library: {}, episode: {} }),
    listMediaSet(env, pid, "storyboard"),
  ]);
  const stills = db.stills || {};
  return {
    index,
    // → { bundle, shot, take, source } — `take` is null when the shot has no
    // usable still (the caller renders a slate); the whole result is null only
    // when the shot belongs to no bundle at all (an unmatched shot).
    resolve(shotId) {
      const hit = index.lookup(shotId);
      if (!hit) return null;
      const take = pickTake(stills[hit.bundle]?.[shotId], files);
      return { bundle: hit.bundle, shot: shotId, take, source: hit.source };
    },
  };
}
