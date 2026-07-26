// Per-document version history for the project JSON doc stores.
//
// R2 has NO object versioning: a `put` over an existing key destroys the old
// bytes forever. That is how Whistlewood's world bible was lost — one partial
// `save_world` overwrote the document and there was nothing to roll back to.
// So every overwrite now parks the PREVIOUS bytes under
// `history/<projectId>/<name>/<stamp>.json` before the new ones land.
//
// This sits ABOVE the storage primitive on purpose (docs.js calls it, not the
// routes), so it covers every doc store — world, shotlist, sounds, cuts,
// episode, visual-world — and survives a future move of the doc backend to D1.
//
// Note on D1 Time Travel: if/when these docs move to D1, its point-in-time
// recovery is whole-DATABASE and destructive (restoring one project's doc would
// roll back everything else). It's disaster recovery; this is per-doc undo. The
// two are complementary, so this layer stays useful either way.
import { normalizeProjectId } from "./docs.js";

// How many versions to keep per document. Small JSON, so this is cheap; the
// oldest are pruned on write.
const MAX_SNAPSHOTS = 50;
// Collapse rapid edits: don't park a version younger than this. A
// field-by-field editing session on the World tab would otherwise burn the
// whole ring buffer in a couple of minutes and leave nothing older than "a
// moment ago". Deliberately narrow — see the two escapes below.
const MIN_INTERVAL_MS = 60_000;
// Escape 1: the throttle only ever collapses versions from the SAME writer.
// Rapid human edits collapse into one; an AGENT write landing on top of fresh
// human edits always parks them, because that is precisely the sequence that
// loses work.
// Escape 2: a write that shrinks the document by more than this always parks,
// whoever made it — a sudden collapse in size is the signature of the accident
// this whole file exists for (a partial save blanking most of a document).
const SHRINK_RATIO = 0.75;

// Doc names come from our own routes, but this key is user-reachable via the
// history routes — keep it to a flat, boring segment.
const safeName = (name) => String(name || "").replace(/[^a-zA-Z0-9._-]/g, "");

// Filename-safe, lexicographically sortable: 2026-07-22T21-56-31-995Z.
export const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");

export const historyPrefix = (projectId, name) =>
  `history/${normalizeProjectId(projectId)}/${safeName(name)}/`;

export const snapshotKey = (projectId, name, ts) =>
  `${historyPrefix(projectId, name)}${safeName(ts)}.json`;

// Parse the stamp back into a real instant for display / throttling.
function stampToDate(ts) {
  // 2026-07-22T21-56-31-995Z -> 2026-07-22T21:56:31.995Z
  const iso = String(ts).replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Newest first. Each entry carries the stored doc's own provenance (`source` /
// `generatedAt`, stashed in R2 custom metadata at snapshot time) so the history
// UI can say "agent" vs "app" without fetching every version.
export async function listSnapshots(env, projectId, name) {
  const prefix = historyPrefix(projectId, name);
  const out = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, cursor, limit: 1000, include: ["customMetadata"] });
    for (const o of res.objects) {
      const ts = o.key.slice(prefix.length).replace(/\.json$/, "");
      out.push({
        ts,
        at: stampToDate(ts)?.toISOString() ?? null,
        size: o.size,
        source: o.customMetadata?.source || null,
        generatedAt: o.customMetadata?.generatedAt || null,
      });
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out;
}

export async function readSnapshot(env, projectId, name, ts) {
  const obj = await env.BUCKET.get(snapshotKey(projectId, name, ts));
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

// Keep the newest MAX_SNAPSHOTS, drop the rest.
async function prune(env, projectId, name, snapshots) {
  const stale = snapshots.slice(MAX_SNAPSHOTS);
  if (!stale.length) return;
  await Promise.all(
    stale.map((s) => env.BUCKET.delete(snapshotKey(projectId, name, s.ts))),
  );
}

// Park `prevText` (the bytes we are about to overwrite) as a version. Call this
// AFTER the new write has succeeded, so a failed/conflicting write leaves no
// phantom history. `nextText` is only used to spot a destructive shrink.
// Never throws: losing a snapshot must not fail the user's actual write.
export async function snapshotPrevious(env, projectId, name, prevText, nextText, opts = {}) {
  try {
    if (!prevText || prevText === nextText) return null;

    // Carry the doc's own provenance into R2 metadata for the history list.
    let source = "";
    let generatedAt = "";
    try {
      const parsed = JSON.parse(prevText);
      source = String(parsed?.source ?? "");
      generatedAt = String(parsed?.generatedAt ?? "");
    } catch {
      /* not our shape — still worth keeping the bytes */
    }

    const existing = await listSnapshots(env, projectId, name);
    const newest = existing[0];
    const shrank = nextText != null && nextText.length < prevText.length * SHRINK_RATIO;
    const sameWriter = newest ? (newest.source || "") === source : false;
    if (newest && !opts.force && !shrank && sameWriter) {
      const at = stampToDate(newest.ts);
      if (at && Date.now() - at.getTime() < MIN_INTERVAL_MS) return null;
    }

    const ts = stamp();
    await env.BUCKET.put(snapshotKey(projectId, name, ts), prevText, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { ...(source && { source }), ...(generatedAt && { generatedAt }) },
    });
    await prune(env, projectId, name, [{ ts }, ...existing]);
    return ts;
  } catch {
    return null;
  }
}
