// Script draft store — the versioned screenplay document set, ported verbatim
// from the Express server (server/index.js ~393-580). The durable store is the
// R2 object `script/<projectId>.json` (same object served by GET/PUT /script in
// worker/src/index.js). Shape is the v2 draft set:
//   { v: 2, pinnedId, drafts: [ { id, name, title, doc, createdAt, updatedAt,
//     clientId } ] }
// The editor and agent tools all read/write the PINNED draft through /api/script;
// the draft set lives behind those endpoints so nothing downstream knows about
// versioning. Everything runs through normalizeStore so partial/legacy blobs are
// always coerced to a well-formed v2 store.

const LEGACY_SCRIPT_KEY = "script/current.json";

// R2 key for a project's script store — mirrors scriptKey() in index.js (kept in
// sync here because that one isn't exported; behaviour must match byte-for-byte).
export function scriptKey(projectId) {
  if (!projectId) return LEGACY_SCRIPT_KEY;
  const safe = String(projectId).replace(/[^a-zA-Z0-9._-]/g, "");
  return safe ? `script/${safe}.json` : LEGACY_SCRIPT_KEY;
}

export const nowIso = () => new Date().toISOString();
export const newDraftId = () => `d_${crypto.randomUUID().slice(0, 8)}`;

// Count the non-empty top-level blocks in a ProseMirror doc (a rough line count
// for the drafts UI — mirrors how the agent's docToElements drops empty blocks).
export function countLines(doc) {
  const blocks = doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : [];
  let n = 0;
  for (const node of blocks) {
    if (node?.type === "title") continue;
    const text = JSON.stringify(node?.content || "");
    if (/"text"\s*:\s*"[^"]/.test(text)) n += 1;
  }
  return n;
}

export function makeDraft({ name, title = "", doc = null, clientId = null }) {
  const ts = nowIso();
  return { id: newDraftId(), name: name || "Draft 1", title, doc, createdAt: ts, updatedAt: ts, clientId, proposal: null };
}

// A staged agent edit awaiting human review. It sits ALONGSIDE the draft's
// committed `doc` (never replaces it) so the Script tab can render a before→after
// diff and accept it in bulk or per line. `baseDoc` snapshots the committed doc
// at propose time so the diff stays stable even if the human keeps editing.
export function makeProposal({ baseDoc = null, proposedDoc = null, proposedTitle = null, note = null, source = "eve", baseUpdatedAt = null }) {
  return {
    baseDoc,
    proposedDoc,
    proposedTitle: typeof proposedTitle === "string" ? proposedTitle : null,
    note: typeof note === "string" ? note : null,
    source: source || "eve",
    baseUpdatedAt: baseUpdatedAt || null,
    createdAt: nowIso(),
  };
}

// Accept any of: a v2 store, a legacy single { title, doc } record, or {} /
// null — and always return a well-formed v2 store with a valid pinnedId.
export function normalizeStore(obj) {
  if (obj && Array.isArray(obj.drafts) && obj.drafts.length) {
    const drafts = obj.drafts.map((d) => ({
      id: typeof d.id === "string" ? d.id : newDraftId(),
      name: typeof d.name === "string" && d.name ? d.name : "Draft",
      title: typeof d.title === "string" ? d.title : "",
      doc: d.doc ?? null,
      createdAt: d.createdAt || nowIso(),
      updatedAt: d.updatedAt || d.createdAt || nowIso(),
      clientId: d.clientId ?? null,
      proposal: d.proposal ?? null,
    }));
    const pinnedId = drafts.some((d) => d.id === obj.pinnedId) ? obj.pinnedId : drafts[0].id;
    return { v: 2, pinnedId, drafts };
  }
  // Legacy single-doc record (pre-versioning) → wrap it as the first draft.
  if (obj && (typeof obj.title === "string" || obj.doc)) {
    const d = makeDraft({ name: "Draft 1", title: obj.title || "", doc: obj.doc ?? null });
    if (obj.updatedAt) d.updatedAt = obj.updatedAt;
    return { v: 2, pinnedId: d.id, drafts: [d] };
  }
  // Empty / unknown → a fresh single blank draft.
  const d = makeDraft({ name: "Draft 1" });
  return { v: 2, pinnedId: d.id, drafts: [d] };
}

export const pinnedDraft = (store) =>
  store.drafts.find((d) => d.id === store.pinnedId) || store.drafts[0];

export const draftMeta = (d, pinnedId) => ({
  id: d.id,
  name: d.name,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lineCount: countLines(d.doc),
  pinned: d.id === pinnedId,
});
export const metaList = (store) => store.drafts.map((d) => draftMeta(d, store.pinnedId));

// Read/write the R2 script object directly (the Worker is the durable store, so
// unlike Express there's no HTTP round-trip to /script). Always normalized.
export async function readStore(env, projectId) {
  const obj = await env.BUCKET.get(scriptKey(projectId));
  if (!obj) return normalizeStore(null);
  try {
    return normalizeStore(await obj.json());
  } catch {
    return normalizeStore(null);
  }
}

export async function writeStore(env, projectId, store) {
  await env.BUCKET.put(scriptKey(projectId), JSON.stringify(store), {
    httpMetadata: { contentType: "application/json" },
  });
}
