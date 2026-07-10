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
