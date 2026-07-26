// Per-project JSON document stores in R2 — `state/<projectId>/<name>.json`.
//
// Mirrors the script store (`script/<id>.json`) and replaces the Express
// server's local JSON files: `selections.json` (the de-facto DB), `shotlist.json`,
// and `sounds.json`. Each store is a whole document (read-modify-write), exactly
// how the Express code treated them, so this is a near-mechanical port.

import { snapshotPrevious } from "./history.js";

// Canonical project-key fallback. Storage (docKey/mediaKey), broadcast, and the
// SSE subscribe route must all resolve a missing/invalid projectId to the SAME
// key — otherwise a write can land in `p_default` while its live-sync event is
// keyed (or skipped) elsewhere and open tabs never hear about the change.
export function normalizeProjectId(projectId) {
  return String(projectId || "p_default").replace(/[^a-zA-Z0-9._-]/g, "") || "p_default";
}

export function docKey(projectId, name) {
  return `state/${normalizeProjectId(projectId)}/${name}.json`;
}

export async function readDoc(env, projectId, name, fallback = null) {
  const obj = await env.BUCKET.get(docKey(projectId, name));
  if (!obj) return fallback;
  try {
    return await obj.json();
  } catch {
    return fallback;
  }
}

// Every overwrite parks the bytes it replaces (see lib/history.js) — R2 has no
// object versioning, so without this a `put` is unrecoverable. The snapshot is
// taken AFTER the write lands and never throws, so version history can't fail
// a user's actual save.
// `opts.forceSnapshot` bypasses the rapid-edit throttle — pass it for writes
// that MUST leave a way back, notably restoring an old version (otherwise a
// restore could silently discard the version it replaced).
export async function writeDoc(env, projectId, name, value, opts = {}) {
  const key = docKey(projectId, name);
  const prev = await env.BUCKET.get(key);
  const prevText = prev ? await prev.text() : null;
  const nextText = JSON.stringify(value);
  await env.BUCKET.put(key, nextText, {
    httpMetadata: { contentType: "application/json" },
  });
  await snapshotPrevious(env, projectId, name, prevText, nextText, {
    force: !!opts.forceSnapshot,
  });
}

// Read-modify-write with optimistic concurrency. Plain readDoc→writeDoc is
// last-writer-wins: when the agent mutates several entries at once (e.g.
// attaching three sound versions back-to-back), parallel writers clobber each
// other's changes. Here the write is conditional on the object's etag not
// having moved since the read; on conflict we re-read and re-apply `mutate`.
//
// `mutate(value)` edits the doc in place and returns a result object for the
// caller; return `{ abort: true, ... }` to skip the write (e.g. 404 paths).
// The mutate callback may run more than once — keep it free of side effects.
export async function updateDoc(env, projectId, name, fallback, mutate) {
  const key = docKey(projectId, name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const obj = await env.BUCKET.get(key);
    let value = null;
    // Read the body ONCE as text: it feeds both the parse and the version
    // snapshot below (an R2 object body can only be consumed once).
    let prevText = null;
    if (obj) {
      prevText = await obj.text();
      try { value = JSON.parse(prevText); } catch { /* corrupt — treat as missing */ }
    }
    if (value == null) value = structuredClone(fallback);
    const result = (await mutate(value)) || {};
    if (result.abort) return result;
    const nextText = JSON.stringify(value);
    const written = await env.BUCKET.put(key, nextText, {
      httpMetadata: { contentType: "application/json" },
      // First write on a fresh doc goes unconditional: two racing creators is
      // a much narrower window than racing updates, and R2's if-not-exists
      // wildcard support is not something we want to depend on.
      ...(obj ? { onlyIf: { etagMatches: obj.etag } } : {}),
    });
    // Only park a version once the write actually won its etag race — a losing
    // attempt retries, and its "previous" is about to be re-read anyway.
    if (written) {
      await snapshotPrevious(env, projectId, name, prevText, nextText);
      return result;
    }
  }
  throw new Error(`updateDoc(${key}): too many concurrent-write conflicts`);
}
