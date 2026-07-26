// Per-document version history for the project doc stores (D1 `doc_history`).
//
// Every overwrite parks the value it replaced, because losing content to a bad
// write is the failure mode this app actually suffered: one partial `save_world`
// flattened a world bible and, on the old R2 backend, there was nothing to roll
// back to.
//
// This is NOT redundant with D1 Time Travel. Time Travel restores the WHOLE
// database to a point in time and is destructive — recovering one project's
// world bible would roll back every other project's shot lists too. That's
// disaster recovery; this is per-document undo. They cover different accidents.
//
// It sits ABOVE the storage primitive on purpose (docs.js calls it, not the
// routes), so every doc store is covered — world, shotlist, sounds, cuts,
// episode, visual-world, script.
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
// Rapid human edits collapse into one; an AGENT write landing on fresh human
// edits always parks them, because that is precisely the sequence that loses
// work.
// Escape 2: a write that shrinks the document by more than this always parks,
// whoever made it — a sudden collapse in size is the signature of the accident
// this whole file exists for (a partial save blanking most of a document).
const SHRINK_RATIO = 0.75;

// Filename-safe, lexicographically sortable: 2026-07-22T21-56-31-995Z.
export const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");

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

const withDate = (r) => ({
  ts: r.ts,
  at: stampToDate(r.ts)?.toISOString() ?? null,
  size: r.size,
  source: r.source || null,
  generatedAt: r.generated_at || null,
});

// Newest first. Deliberately does NOT select `json` — a history list is a
// picker, and pulling every stored version's body to render it would be silly.
export async function listSnapshots(env, projectId, name) {
  const { results } = await env.DB.prepare(
    "SELECT ts, size, source, generated_at FROM doc_history WHERE project_id = ? AND name = ? ORDER BY ts DESC",
  )
    .bind(normalizeProjectId(projectId), name)
    .all();
  return (results || []).map(withDate);
}

export async function readSnapshot(env, projectId, name, ts) {
  const row = await env.DB.prepare(
    "SELECT json FROM doc_history WHERE project_id = ? AND name = ? AND ts = ?",
  )
    .bind(normalizeProjectId(projectId), name, String(ts))
    .first();
  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

// Park `prevText` (the value we just overwrote) as a version. Call this AFTER
// the new write has succeeded, so a failed/conflicting write leaves no phantom
// history. `nextText` is only used to spot a destructive shrink.
// Never throws: losing a snapshot must not fail the user's actual write.
export async function snapshotPrevious(env, projectId, name, prevText, nextText, opts = {}) {
  try {
    if (!prevText || prevText === nextText) return null;
    const pid = normalizeProjectId(projectId);

    // The replaced document's own provenance, so the history list can show who
    // wrote it without loading every version.
    let source = "";
    let generatedAt = "";
    try {
      const parsed = JSON.parse(prevText);
      source = String(parsed?.source ?? "");
      generatedAt = String(parsed?.generatedAt ?? "");
    } catch {
      /* not our shape — still worth keeping the value */
    }

    const newest = await env.DB.prepare(
      "SELECT ts, source FROM doc_history WHERE project_id = ? AND name = ? ORDER BY ts DESC LIMIT 1",
    )
      .bind(pid, name)
      .first();
    const shrank = nextText != null && nextText.length < prevText.length * SHRINK_RATIO;
    const sameWriter = newest ? (newest.source || "") === source : false;
    if (newest && !opts.force && !shrank && sameWriter) {
      const at = stampToDate(newest.ts);
      if (at && Date.now() - at.getTime() < MIN_INTERVAL_MS) return null;
    }

    const ts = stamp();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO doc_history (project_id, name, ts, json, source, generated_at, size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, name, ts) DO NOTHING",
      ).bind(pid, name, ts, prevText, source || null, generatedAt || null, prevText.length),
      // Ring buffer: keep the newest MAX_SNAPSHOTS for this doc, drop the rest.
      env.DB.prepare(
        `DELETE FROM doc_history WHERE project_id = ? AND name = ? AND ts NOT IN (
           SELECT ts FROM doc_history WHERE project_id = ? AND name = ? ORDER BY ts DESC LIMIT ?
         )`,
      ).bind(pid, name, pid, name, MAX_SNAPSHOTS),
    ]);
    return ts;
  } catch {
    return null;
  }
}
