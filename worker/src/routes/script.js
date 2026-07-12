// Script endpoints, ported from server/index.js (/api/script*). The durable store
// is the R2 object `script/<projectId>.json` (the same object served by GET/PUT
// /script in worker/src/index.js) — read/written straight from R2 here instead of
// the Express HTTP round-trip. Sign-off lives in the selections DB doc
// (`state/<projectId>/selections.json` → scriptSignoff[draftId]). Writes that
// change the pinned draft broadcast on the "script" channel for live-sync.
import { readDoc, writeDoc } from "../lib/docs.js";
import { broadcast } from "../lib/broadcast.js";
import {
  nowIso,
  makeDraft,
  makeProposal,
  pinnedDraft,
  draftMeta,
  metaList,
  readStore,
  writeStore,
} from "../lib/script-store.js";

// The selections doc doubles as the de-facto DB (mirrors Express readDB/writeDB);
// scriptSignoff is a top-level key on it.
const readDB = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeDB = (env, pid, db) => writeDoc(env, pid, "selections", db);

// Mirror of Express broadcastScript — fan the pinned-script change out to the
// project's open Script tabs over SSE. Non-blocking: the DO fan-out runs under
// the request's executionCtx so a slow DO never delays the write's response.
const broadcastScript = (c, pid, payload) => broadcast(c.env, pid, "script", payload, c.executionCtx);

export function registerScript(app) {
  // Read the PINNED draft (plus the drafts index so the UI can render the
  // version-control menu in one round-trip). Shape stays backward-compatible:
  // { title, doc, updatedAt, clientId } is what the editor + agent tools read.
  app.get("/api/script", async (c) => {
    const pid = c.get("projectId");
    try {
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      const db = await readDB(c.env, pid);
      const sign = db.scriptSignoff?.[d.id] || null;
      const shotlist = await readDoc(c.env, pid, "shotlist", null);
      return c.json({
        title: d.title,
        doc: d.doc,
        updatedAt: d.updatedAt,
        clientId: d.clientId,
        draftId: d.id,
        draftName: d.name,
        pinnedId: store.pinnedId,
        drafts: metaList(store),
        // A staged agent edit awaiting review (before/after docs for the diff),
        // or null. Present → the Script tab renders the accept/reject diff view.
        proposal: d.proposal || null,
        // Pipeline gate: the pinned draft's sign-off + whether a shot list already
        // exists (so the Script tab can enable/disable "Generate shot list").
        signed: !!sign,
        signedAt: sign?.at || null,
        shotlistExists: !!shotlist,
      });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Sign / unsign the PINNED script draft. A signed draft unlocks the next stage
  // (generate the shot list). Any edit to the draft clears this (see PUT below).
  app.post("/api/script/sign", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { signed = true, by } = body || {};
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      const db = await readDB(c.env, pid);
      db.scriptSignoff = db.scriptSignoff || {};
      if (signed) db.scriptSignoff[d.id] = { at: new Date().toISOString(), by: by || null };
      else delete db.scriptSignoff[d.id];
      await writeDB(c.env, pid, db);
      return c.json({ ok: true, draftId: d.id, signed: !!signed, signedAt: db.scriptSignoff[d.id]?.at || null });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Save into the PINNED draft (the editor autosave + agent save/append tools).
  app.put("/api/script", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { title, doc, clientId } = body || {};
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      d.title = typeof title === "string" ? title : "";
      d.doc = doc ?? null;
      d.updatedAt = nowIso();
      d.clientId = clientId ?? null;
      d.proposal = null; // a direct save supersedes any pending agent proposal
      await writeStore(c.env, pid, store);
      // Editing the script invalidates its sign-off — it must be re-signed before
      // the shot list can be (re)generated from it.
      const db = await readDB(c.env, pid);
      if (db.scriptSignoff?.[d.id]) { delete db.scriptSignoff[d.id]; await writeDB(c.env, pid, db); }
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
      return c.json({ ok: true, updatedAt: d.updatedAt, draftId: d.id });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // --- Agent edit proposals (review before commit) --------------------------
  // Stage a full proposed doc against the PINNED draft WITHOUT committing it. The
  // draft's `doc` is untouched; the Script tab renders a before→after diff and the
  // human accepts (in bulk or per line) or rejects. Used by the agent's
  // save_script / append_script tools so their edits are reviewable, not silent.
  app.put("/api/script/proposal", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { proposedDoc, title, note, clientId } = body || {};
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      d.proposal = makeProposal({
        baseDoc: d.doc ?? null,
        proposedDoc: proposedDoc ?? null,
        proposedTitle: typeof title === "string" ? title : d.title,
        note,
        source: "eve",
        baseUpdatedAt: d.updatedAt,
      });
      await writeStore(c.env, pid, store);
      // proposal:true tells open Script tabs to flip into the review/diff view.
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId, proposal: true });
      return c.json({ ok: true, draftId: d.id });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Accept a pending proposal. The client sends the RESOLVED doc (the proposed
  // doc with the human's per-line accept/reject applied), which becomes the
  // committed content — accepting invalidates the sign-off just like a save.
  app.post("/api/script/proposal/accept", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { doc, title, clientId } = body || {};
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      if (!d.proposal) return c.json({ error: "no pending proposal" }, 409);
      d.doc = doc ?? d.proposal.proposedDoc ?? d.doc ?? null;
      if (typeof title === "string") d.title = title;
      d.proposal = null;
      d.updatedAt = nowIso();
      d.clientId = clientId ?? null;
      await writeStore(c.env, pid, store);
      const db = await readDB(c.env, pid);
      if (db.scriptSignoff?.[d.id]) { delete db.scriptSignoff[d.id]; await writeDB(c.env, pid, db); }
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
      return c.json({ ok: true, updatedAt: d.updatedAt, draftId: d.id });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Reject (discard) a pending proposal — the committed content is left untouched.
  app.post("/api/script/proposal/reject", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const clientId = body?.clientId ?? null;
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      if (!d.proposal) return c.json({ ok: true, draftId: d.id });
      d.proposal = null;
      await writeStore(c.env, pid, store);
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId, pinnedId: store.pinnedId, proposal: false });
      return c.json({ ok: true, draftId: d.id });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // --- Script drafts (version control) --------------------------------------
  // List every draft + which one is pinned.
  app.get("/api/script/drafts", async (c) => {
    const pid = c.get("projectId");
    try {
      const store = await readStore(c.env, pid);
      return c.json({ drafts: metaList(store), pinnedId: store.pinnedId });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Create a new draft. By default it clones the current pinned draft's content
  // (so "save current, keep writing on a fresh version"); pass { blank: true } to
  // start empty. The new draft becomes pinned; the previous one stays in history.
  app.post("/api/script/drafts", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { name, blank, clientId } = body || {};
      const store = await readStore(c.env, pid);
      const cur = pinnedDraft(store);
      const draft = makeDraft({
        name: typeof name === "string" && name.trim() ? name.trim() : `Draft ${store.drafts.length + 1}`,
        title: blank ? "" : cur.title,
        doc: blank ? null : cur.doc,
        clientId: clientId ?? null,
      });
      store.drafts.push(draft);
      store.pinnedId = draft.id;
      await writeStore(c.env, pid, store);
      await broadcastScript(c, pid, { updatedAt: draft.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
      return c.json({ ok: true, draft: draftMeta(draft, store.pinnedId), drafts: metaList(store), pinnedId: store.pinnedId });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Switch the pinned (active) draft — everything (editor + agent) now edits it.
  app.post("/api/script/pin", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { id, clientId } = body || {};
      const store = await readStore(c.env, pid);
      if (!store.drafts.some((d) => d.id === id)) {
        return c.json({ error: `no draft ${id}` }, 404);
      }
      store.pinnedId = id;
      await writeStore(c.env, pid, store);
      const d = pinnedDraft(store);
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
      return c.json({ ok: true, pinnedId: store.pinnedId, drafts: metaList(store) });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Rename a draft.
  app.patch("/api/script/drafts/:id", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { name, clientId } = body || {};
      const store = await readStore(c.env, pid);
      const d = store.drafts.find((x) => x.id === c.req.param("id"));
      if (!d) return c.json({ error: `no draft ${c.req.param("id")}` }, 404);
      if (typeof name === "string" && name.trim()) d.name = name.trim();
      await writeStore(c.env, pid, store);
      await broadcastScript(c, pid, { updatedAt: nowIso(), clientId: clientId ?? null, pinnedId: store.pinnedId });
      return c.json({ ok: true, drafts: metaList(store), pinnedId: store.pinnedId });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Delete a draft (never the last one). If the pinned draft is removed, pin the
  // most recently updated of what remains.
  app.delete("/api/script/drafts/:id", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const clientId = body?.clientId ?? null;
      const store = await readStore(c.env, pid);
      if (store.drafts.length <= 1) {
        return c.json({ error: "cannot delete the only draft" }, 400);
      }
      const idx = store.drafts.findIndex((d) => d.id === c.req.param("id"));
      if (idx < 0) return c.json({ error: `no draft ${c.req.param("id")}` }, 404);
      const wasPinned = store.pinnedId === c.req.param("id");
      store.drafts.splice(idx, 1);
      if (wasPinned) {
        store.pinnedId = [...store.drafts].sort((a, b) =>
          (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0].id;
      }
      await writeStore(c.env, pid, store);
      const d = pinnedDraft(store);
      await broadcastScript(c, pid, { updatedAt: d.updatedAt, clientId, pinnedId: store.pinnedId });
      return c.json({ ok: true, drafts: metaList(store), pinnedId: store.pinnedId });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
