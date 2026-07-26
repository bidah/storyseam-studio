// Per-project JSON document stores — the app's state layer.
//
// These live in D1 (`docs` table, one row per project+doc), NOT in R2. R2 is
// blob storage: no transactions, no versioning, and a `put` destroys the bytes
// it replaces with no way back — which is how a world bible was lost. D1 gives
// transactional writes, a `version` column for real optimistic concurrency
// (replacing the old etag retry dance), and Time Travel: 30 days of automatic
// point-in-time recovery for the whole database. Media blobs stay in R2.
//
// The document shape is unchanged — whole-document read-modify-write, exactly
// as the routes have always used it — so this swap is invisible above this file.
//
// The pre-cutover `state/<projectId>/<name>.json` objects were migrated into the
// `docs` table and then removed from R2 (`POST /api/admin/migrate-docs`, then
// `POST /api/admin/purge-legacy-docs`): per-tenant state does not belong in a
// blob bucket. There is no R2 read path left here.
import { snapshotPrevious } from "./history.js";

// Canonical project-key fallback. Storage, broadcast, and the SSE subscribe
// route must all resolve a missing/invalid projectId to the SAME key —
// otherwise a write can land under one key while its live-sync event is keyed
// (or skipped) elsewhere and open tabs never hear about the change.
export function normalizeProjectId(projectId) {
  return String(projectId || "p_default").replace(/[^a-zA-Z0-9._-]/g, "") || "p_default";
}

const now = () => new Date().toISOString();

// Raw row read — the document text plus the CAS token. `null` when it doesn't
// exist yet.
async function readRow(env, projectId, name) {
  const row = await env.DB.prepare(
    "SELECT json, version FROM docs WHERE project_id = ? AND name = ?",
  )
    .bind(normalizeProjectId(projectId), name)
    .first();
  return row ? { text: row.json, version: row.version } : null;
}

export async function readDoc(env, projectId, name, fallback = null) {
  const row = await readRow(env, projectId, name);
  if (!row) return fallback;
  try {
    return JSON.parse(row.text);
  } catch {
    return fallback;
  }
}

// Last-writer-wins whole-document write. `opts.forceSnapshot` bypasses the
// version-history rapid-edit throttle — pass it for writes that MUST leave a
// way back, notably restoring an old version.
export async function writeDoc(env, projectId, name, value, opts = {}) {
  const pid = normalizeProjectId(projectId);
  const prev = await readRow(env, projectId, name);
  const nextText = JSON.stringify(value);
  await env.DB.prepare(
    `INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (project_id, name) DO UPDATE SET json = excluded.json, version = docs.version + 1, updated_at = excluded.updated_at`,
  )
    .bind(pid, name, nextText, now())
    .run();
  await snapshotPrevious(env, projectId, name, prev?.text ?? null, nextText, {
    force: !!opts.forceSnapshot,
  });
}

// Read-modify-write with optimistic concurrency. Plain readDoc→writeDoc is
// last-writer-wins: when the agent mutates several entries at once (e.g.
// attaching three sound versions back-to-back), parallel writers clobber each
// other's changes. Here the write is conditional on the row's `version` not
// having moved since the read; on conflict we re-read and re-apply `mutate`.
//
// `mutate(value)` edits the doc in place and returns a result object for the
// caller; return `{ abort: true, ... }` to skip the write (e.g. 404 paths).
// The mutate callback may run more than once — keep it free of side effects.
//
// Losers back off with jitter before retrying. Without it every contender
// re-reads and re-writes in lockstep and simply collides again — a burst of 8
// concurrent adds reliably exhausted a flat 6-attempt loop and 500'd.
const MAX_ATTEMPTS = 12;
const backoff = (attempt) =>
  new Promise((r) => setTimeout(r, Math.round((2 ** attempt) * 4 * (0.5 + Math.random()))));

export async function updateDoc(env, projectId, name, fallback, mutate) {
  const pid = normalizeProjectId(projectId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await backoff(attempt);
    const row = await readRow(env, projectId, name);
    let value = null;
    if (row) {
      try { value = JSON.parse(row.text); } catch { /* corrupt — treat as missing */ }
    }
    if (value == null) value = structuredClone(fallback);
    const result = (await mutate(value)) || {};
    if (result.abort) return result;
    const nextText = JSON.stringify(value);

    // Conditional on the version we read. `changes === 0` means another writer
    // got there first, so we re-read and re-apply.
    const written = row
      ? await env.DB.prepare(
          "UPDATE docs SET json = ?, version = version + 1, updated_at = ? WHERE project_id = ? AND name = ? AND version = ?",
        )
          .bind(nextText, now(), pid, name, row.version)
          .run()
      // First write on a fresh doc: DO NOTHING on conflict, so two racing
      // creators don't clobber each other — the loser re-reads and retries.
      : await env.DB.prepare(
          "INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (project_id, name) DO NOTHING",
        )
          .bind(pid, name, nextText, now())
          .run();

    if (written?.meta?.changes > 0) {
      await snapshotPrevious(env, projectId, name, row?.text ?? null, nextText);
      return result;
    }
  }
  throw new Error(`updateDoc(${pid}/${name}): too many concurrent-write conflicts`);
}
