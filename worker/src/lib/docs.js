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
// Capped: uncapped exponential growth put the 12th retry ~8s out on its own and
// a fully-contended request ~16s, which is worse than the collisions it avoids.
// A few hundred ms of jitter is all that's needed to break lockstep.
const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 250;
const backoff = (attempt) =>
  new Promise((r) =>
    setTimeout(r, Math.round(Math.min(MAX_BACKOFF_MS, 2 ** attempt * 4) * (0.5 + Math.random()))),
  );

// `opts.also` — extra documents to write ATOMICALLY with this one: `[{ name,
// value }]`. Some operations span two documents and are only correct together.
// The episode rebuild is the case in point: it re-keys every pick, still, render
// and sign-off in `selections` from old bundle ids to new ones, and writes the
// new bundle definitions to `episode-manifest`. Bundle ids are positional slot
// numbers, so if only one of those two lands, the surviving picks and stills
// point at the WRONG scenes — a silent corruption, not a visible failure.
//
// How the guarantee works: all statements go in ONE D1 batch, which is a single
// transaction. The primary row is compare-and-swapped as usual and stamped with
// a fresh `write_token`; every `also` row is guarded on the primary carrying
// THAT token. If the CAS loses, no row has the token, so no `also` row is
// written either — all of them land or none do.
//
// The token is why this needs a column of its own. Guarding on "the primary's
// version is now what I expected plus one" looks equivalent and is not: a
// concurrent writer bumping the primary by exactly one satisfies that guard,
// and the secondary sails through on its own. A per-attempt nonce cannot be
// forged that way.
//
// `also` rows are written unconditionally (no CAS of their own), so this is for
// documents whose only writer is the operation holding the primary — as with
// `episode-manifest`, written from the rebuild route and nowhere else.
export async function updateDoc(env, projectId, name, fallback, mutate, opts = {}) {
  const pid = normalizeProjectId(projectId);
  const also = Array.isArray(opts.also) ? opts.also : [];
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
    const at = now();
    const token = crypto.randomUUID();

    // Conditional on the version we read. `changes === 0` means another writer
    // got there first, so we re-read and re-apply.
    const primary = row
      ? env.DB.prepare(
          "UPDATE docs SET json = ?, version = version + 1, updated_at = ?, write_token = ? WHERE project_id = ? AND name = ? AND version = ?",
        ).bind(nextText, at, token, pid, name, row.version)
      // First write on a fresh doc: DO NOTHING on conflict, so two racing
      // creators don't clobber each other — the loser re-reads and retries.
      : env.DB.prepare(
          "INSERT INTO docs (project_id, name, json, version, updated_at, write_token) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT (project_id, name) DO NOTHING",
        ).bind(pid, name, nextText, at, token);

    let written;
    let alsoPrev = [];
    if (!also.length) {
      written = await primary.run();
    } else {
      // Read what the extra documents are replacing, so their versions get
      // parked too once the batch commits.
      alsoPrev = await Promise.all(also.map((d) => readRow(env, projectId, d.name)));
      const stmts = [primary];
      for (const d of also) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO docs (project_id, name, json, version, updated_at)
             SELECT ?, ?, ?, 1, ?
              WHERE EXISTS (SELECT 1 FROM docs WHERE project_id = ? AND name = ? AND write_token = ?)
             ON CONFLICT (project_id, name) DO UPDATE
                SET json = excluded.json, version = docs.version + 1, updated_at = excluded.updated_at`,
          ).bind(pid, d.name, JSON.stringify(d.value), at, pid, name, token),
        );
      }
      [written] = await env.DB.batch(stmts);
    }

    if (written?.meta?.changes > 0) {
      await snapshotPrevious(env, projectId, name, row?.text ?? null, nextText);
      for (let i = 0; i < also.length; i++) {
        await snapshotPrevious(
          env, projectId, also[i].name,
          alsoPrev[i]?.text ?? null, JSON.stringify(also[i].value),
        );
      }
      return result;
    }
  }
  throw new Error(`updateDoc(${pid}/${name}): too many concurrent-write conflicts`);
}
