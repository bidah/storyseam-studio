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

import { readDoc, writeDoc, updateDoc } from "./docs.js";

// The doc-store name this lives under in D1.
const SCRIPT_DOC = "script";

const LEGACY_SCRIPT_KEY = "script/current.json";

// The PRE-CUTOVER R2 key for a project's script store. Read-only now: it exists
// only so `readStore` can find and migrate a script that predates D1.
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

// The id of the project's currently pinned script draft, or null if it can't be
// read. Downstream docs (the shot list, the episode manifest) stamp this at
// generation time so their readers can tell the doc was built from a DIFFERENT
// draft than the one now open — the author switched or created a draft — and
// show a blank "regenerate for this draft" state instead of stale content.
// Null-safe on purpose: a failure here must never break a shot-list read, it
// just means "can't tell — treat as not stale".
export async function pinnedDraftId(env, projectId) {
  try {
    return pinnedDraft(await readStore(env, projectId))?.id || null;
  } catch {
    return null;
  }
}

export const draftMeta = (d, pinnedId) => ({
  id: d.id,
  name: d.name,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lineCount: countLines(d.doc),
  pinned: d.id === pinnedId,
});
export const metaList = (store) => store.drafts.map((d) => draftMeta(d, store.pinnedId));

// The script store is an ordinary project document (`docs` row, name "script"),
// so it inherits D1's transactional writes and the same per-document version
// history as the world bible and the shot list. Always normalized.
//
// TRANSITIONAL: scripts written before the D1 cutover are R2 objects at
// `script/<projectId>.json` — a key shape of their own, so docs.js's read-through
// fallback (which looks under `state/…`) can't find them. Read those once and
// seat them in D1. Removable with the docs.js fallback once neither fires.
export async function readStore(env, projectId) {
  const doc = await readDoc(env, projectId, SCRIPT_DOC, null);
  if (doc) return normalizeStore(doc);

  const obj = env.BUCKET ? await env.BUCKET.get(scriptKey(projectId)) : null;
  if (!obj) return normalizeStore(null);
  let legacy = null;
  try {
    legacy = await obj.json();
  } catch {
    return normalizeStore(null);
  }
  const store = normalizeStore(legacy);
  try {
    // guard:allow-write-doc — seating a pre-D1 R2 script into the docs table for
    // the first time. There is nothing to merge with (the row does not exist),
    // and it runs at most once per project.
    await writeDoc(env, projectId, SCRIPT_DOC, store);
  } catch { /* backfill is opportunistic — the read still succeeds */ }
  return store;
}

// Mutate the store under a compare-and-swap.
//
// Every draft operation — autosave, pin, rename, delete, stage/accept/reject a
// proposal — used to be `readStore` → mutate → `writeStore`, which is
// last-writer-wins over the WHOLE draft set. Two operations landing together
// (the author's autosave while the agent stages a proposal, a rename racing a
// pin) meant one of them silently vanished: no error, no failed request, just a
// draft that reverted. `updateDoc` retries the mutation against a fresh read
// whenever the row moved under it, so both land.
//
// `mutate(store)` receives the normalized store, edits it in place, and returns
// a result for the caller (`{ abort: true, … }` skips the write — use it for the
// 404 / conflict paths). It may run more than once, so keep it side-effect free.
//
// The `readStore` first is not redundant: it performs the one-time legacy-R2
// backfill, so a project whose script still predates the D1 cutover doesn't get
// a blank store created over the top of it by the update below.
export async function updateStore(env, projectId, mutate) {
  await readStore(env, projectId);
  return updateDoc(env, projectId, SCRIPT_DOC, {}, async (value) => {
    const store = normalizeStore(Object.keys(value).length ? value : null);
    const result = (await mutate(store)) || {};
    if (result.abort) return result;
    // updateDoc serializes the object it handed us, so the normalized-and-mutated
    // shape has to be written back onto it rather than returned.
    for (const key of Object.keys(value)) delete value[key];
    Object.assign(value, store);
    return result;
  });
}

// Whole-document replace. Only for callers that genuinely own the entire store
// for the duration of the write; everything that edits part of it wants
// `updateStore` above.
export async function writeStore(env, projectId, store) {
  // guard:allow-write-doc — explicit whole-document replace, kept for callers
  // that already hold the complete store (imports and restores). Draft edits go
  // through updateStore.
  await writeDoc(env, projectId, SCRIPT_DOC, store);
}
