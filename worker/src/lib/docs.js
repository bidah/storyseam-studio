// Per-project JSON document stores in R2 — `state/<projectId>/<name>.json`.
//
// Mirrors the script store (`script/<id>.json`) and replaces the Express
// server's local JSON files: `selections.json` (the de-facto DB), `shotlist.json`,
// and `sounds.json`. Each store is a whole document (read-modify-write), exactly
// how the Express code treated them, so this is a near-mechanical port.

export function docKey(projectId, name) {
  const safe = String(projectId || "p_default").replace(/[^a-zA-Z0-9._-]/g, "") || "p_default";
  return `state/${safe}/${name}.json`;
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

export async function writeDoc(env, projectId, name, value) {
  await env.BUCKET.put(docKey(projectId, name), JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
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
    if (obj) {
      try { value = await obj.json(); } catch { /* corrupt — treat as missing */ }
    }
    if (value == null) value = structuredClone(fallback);
    const result = (await mutate(value)) || {};
    if (result.abort) return result;
    const written = await env.BUCKET.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
      // First write on a fresh doc goes unconditional: two racing creators is
      // a much narrower window than racing updates, and R2's if-not-exists
      // wildcard support is not something we want to depend on.
      ...(obj ? { onlyIf: { etagMatches: obj.etag } } : {}),
    });
    if (written) return result;
  }
  throw new Error(`updateDoc(${key}): too many concurrent-write conflicts`);
}
