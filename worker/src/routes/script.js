// Script endpoints, ported from server/index.js (/api/script*). The durable store
// is the R2 object `script/<projectId>.json` (the same object served by GET/PUT
// /script in worker/src/index.js) — read/written straight from R2 here instead of
// the Express HTTP round-trip. Sign-off lives in the selections DB doc
// (the `selections` doc → scriptSignoff[draftId]). Writes that
// change the pinned draft broadcast on the "script" channel for live-sync.
import { readDoc, updateDoc } from "../lib/docs.js";
import { broadcast } from "../lib/broadcast.js";
import { makeShareToken, isWorldShared, isScriptShared } from "../lib/share-token.js";
import { SHARE_DOC } from "./share.js";
import { SPECIALISTS, isSpecialist, cleanNotes, readReviews, recordReview, reviewState, digestReviews } from "../lib/reviews.js";
// The roster itself (ids + how each specialist is named, what lane and stage it
// belongs to) ships to the client with the review state, so no surface has to
// keep its own copy of the names — see lib/specialists.ts.
import { SPECIALISTS as SPECIALIST_ROSTER } from "../lib/specialists.ts";
import { lintScript, elementsFromDoc } from "../lib/script-lint.js";
import {
  nowIso,
  makeDraft,
  makeProposal,
  pinnedDraft,
  draftMeta,
  metaList,
  countLines,
  readStore,
  updateStore,
} from "../lib/script-store.js";

// The selections doc doubles as the de-facto DB (mirrors Express readDB/writeDB);
// scriptSignoff is a top-level key on it.
const DB_FALLBACK = { library: {}, episode: {} };
const readDB = (env, pid) => readDoc(env, pid, "selections", DB_FALLBACK);
// CONCURRENCY: `selections` is the SHARED de-facto DB, so a readDoc→writeDoc
// pair here writes the whole document back and reverts whatever another surface
// (Editor autosave, Episode picks, Library toggles) changed in between. Only the
// sign-off slice is ours to touch, so mutate it under a compare-and-swap.
const editDB = (env, pid, mutate) => updateDoc(env, pid, "selections", DB_FALLBACK, mutate);

// Mirror of Express broadcastScript — fan the pinned-script change out to the
// project's open Script tabs over SSE. Non-blocking: the DO fan-out runs under
// the request's executionCtx so a slow DO never delays the write's response.
const broadcastScript = (c, pid, payload) => broadcast(c.env, pid, "script", payload, c.executionCtx);

// The PINNED draft plus everything a reader needs in one round-trip (the drafts
// index, sign-off, pending proposal, review state). Extracted from the route so
// non-HTTP callers — the MCP server's `get_script` — get the SAME payload the
// editor and the flue agent read, rather than a second, drifting projection.
// Shape stays backward-compatible: { title, doc, updatedAt, clientId } is the
// part every existing client depends on.
export async function buildScriptView(env, pid) {
  const store = await readStore(env, pid);
  const d = pinnedDraft(store);
  const db = await readDB(env, pid);
  const sign = db.scriptSignoff?.[d.id] || null;
  const shotlist = await readDoc(env, pid, "shotlist", null);
  const reviews = digestReviews(
    reviewState(await readReviews(env, pid), {
      pinnedId: d.id,
      scriptUpdatedAt: d.updatedAt,
    }),
  );
  return {
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
    // Which script specialists have looked at THIS revision of the pinned
    // draft ({ latest, pending, stale, fresh } — see lib/reviews.js). The
    // agent reads it to know which doctor to offer next; the app renders it
    // as the Script tab's review chips and the chat's suggestion cards.
    reviews,
  };
}

export function registerScript(app) {
  // Read the PINNED draft (plus the drafts index so the UI can render the
  // version-control menu in one round-trip).
  app.get("/api/script", async (c) => {
    try {
      return c.json(await buildScriptView(c.env, c.get("projectId")));
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
      const { signedAt } = await editDB(c.env, pid, (db) => {
        db.scriptSignoff = db.scriptSignoff || {};
        if (signed) db.scriptSignoff[d.id] = { at: new Date().toISOString(), by: by || null };
        else delete db.scriptSignoff[d.id];
        return { signedAt: db.scriptSignoff[d.id]?.at || null };
      });
      return c.json({ ok: true, draftId: d.id, signed: !!signed, signedAt });
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
      const { draftId, updatedAt, pinnedId } = await updateStore(c.env, pid, (store) => {
        const d = pinnedDraft(store);
        d.title = typeof title === "string" ? title : "";
        d.doc = doc ?? null;
        d.updatedAt = nowIso();
        d.clientId = clientId ?? null;
        d.proposal = null; // a direct save supersedes any pending agent proposal
        return { draftId: d.id, updatedAt: d.updatedAt, pinnedId: store.pinnedId };
      });
      // Editing the script invalidates its sign-off — it must be re-signed before
      // the shot list can be (re)generated from it.
      await editDB(c.env, pid, (db) => {
        if (!db.scriptSignoff?.[draftId]) return { abort: true };
        delete db.scriptSignoff[draftId];
      });
      await broadcastScript(c, pid, { updatedAt, clientId: clientId ?? null, pinnedId });
      return c.json({ ok: true, updatedAt, draftId });
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
      const { draftId, updatedAt, pinnedId } = await updateStore(c.env, pid, (store) => {
        const d = pinnedDraft(store);
        d.proposal = makeProposal({
          baseDoc: d.doc ?? null,
          proposedDoc: proposedDoc ?? null,
          proposedTitle: typeof title === "string" ? title : d.title,
          note,
          source: "eve",
          baseUpdatedAt: d.updatedAt,
        });
        return { draftId: d.id, updatedAt: d.updatedAt, pinnedId: store.pinnedId };
      });
      // proposal:true tells open Script tabs to flip into the review/diff view.
      await broadcastScript(c, pid, { updatedAt, clientId: clientId ?? null, pinnedId, proposal: true });
      return c.json({ ok: true, draftId });
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
      const res = await updateStore(c.env, pid, (store) => {
        const d = pinnedDraft(store);
        if (!d.proposal) return { abort: true, missing: true };
        d.doc = doc ?? d.proposal.proposedDoc ?? d.doc ?? null;
        if (typeof title === "string") d.title = title;
        d.proposal = null;
        d.updatedAt = nowIso();
        d.clientId = clientId ?? null;
        return { draftId: d.id, updatedAt: d.updatedAt, pinnedId: store.pinnedId };
      });
      if (res.missing) return c.json({ error: "no pending proposal" }, 409);
      await editDB(c.env, pid, (db) => {
        if (!db.scriptSignoff?.[res.draftId]) return { abort: true };
        delete db.scriptSignoff[res.draftId];
      });
      await broadcastScript(c, pid, { updatedAt: res.updatedAt, clientId: clientId ?? null, pinnedId: res.pinnedId });
      return c.json({ ok: true, updatedAt: res.updatedAt, draftId: res.draftId });
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
      const res = await updateStore(c.env, pid, (store) => {
        const d = pinnedDraft(store);
        // Nothing staged — abort the write but still report the draft, so a
        // double-reject is idempotent rather than an error.
        if (!d.proposal) return { abort: true, draftId: d.id, noop: true };
        d.proposal = null;
        return { draftId: d.id, updatedAt: d.updatedAt, pinnedId: store.pinnedId };
      });
      if (res.noop) return c.json({ ok: true, draftId: res.draftId });
      await broadcastScript(c, pid, { updatedAt: res.updatedAt, clientId, pinnedId: res.pinnedId, proposal: false });
      return c.json({ ok: true, draftId: res.draftId });
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
  // start empty, or pass an explicit { doc, title } to SEED the draft — that's the
  // import path (a converted .fountain lands as its own draft). The new draft
  // becomes pinned; the previous one stays in history.
  app.post("/api/script/drafts", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { name, blank, clientId, doc, title } = body || {};
      const seeded = doc !== undefined; // explicit content seed (importer)
      const res = await updateStore(c.env, pid, (store) => {
        const cur = pinnedDraft(store);
        const draft = makeDraft({
          name: typeof name === "string" && name.trim() ? name.trim() : `Draft ${store.drafts.length + 1}`,
          title: seeded ? (typeof title === "string" ? title : "") : (blank ? "" : cur.title),
          doc: seeded ? (doc ?? null) : (blank ? null : cur.doc),
          clientId: clientId ?? null,
        });
        store.drafts.push(draft);
        store.pinnedId = draft.id;
        return {
          updatedAt: draft.updatedAt,
          pinnedId: store.pinnedId,
          draft: draftMeta(draft, store.pinnedId),
          drafts: metaList(store),
        };
      });
      await broadcastScript(c, pid, { updatedAt: res.updatedAt, clientId: clientId ?? null, pinnedId: res.pinnedId });
      return c.json({ ok: true, draft: res.draft, drafts: res.drafts, pinnedId: res.pinnedId });
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
      const res = await updateStore(c.env, pid, (store) => {
        if (!store.drafts.some((d) => d.id === id)) return { abort: true, missing: true };
        store.pinnedId = id;
        const d = pinnedDraft(store);
        return { updatedAt: d.updatedAt, pinnedId: store.pinnedId, drafts: metaList(store) };
      });
      if (res.missing) return c.json({ error: `no draft ${id}` }, 404);
      await broadcastScript(c, pid, { updatedAt: res.updatedAt, clientId: clientId ?? null, pinnedId: res.pinnedId });
      return c.json({ ok: true, pinnedId: res.pinnedId, drafts: res.drafts });
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
      const res = await updateStore(c.env, pid, (store) => {
        const d = store.drafts.find((x) => x.id === c.req.param("id"));
        if (!d) return { abort: true, missing: true };
        if (typeof name === "string" && name.trim()) d.name = name.trim();
        return { pinnedId: store.pinnedId, drafts: metaList(store) };
      });
      if (res.missing) return c.json({ error: `no draft ${c.req.param("id")}` }, 404);
      await broadcastScript(c, pid, { updatedAt: nowIso(), clientId: clientId ?? null, pinnedId: res.pinnedId });
      return c.json({ ok: true, drafts: res.drafts, pinnedId: res.pinnedId });
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
      const res = await updateStore(c.env, pid, (store) => {
        if (store.drafts.length <= 1) return { abort: true, last: true };
        const idx = store.drafts.findIndex((d) => d.id === c.req.param("id"));
        if (idx < 0) return { abort: true, missing: true };
        const wasPinned = store.pinnedId === c.req.param("id");
        store.drafts.splice(idx, 1);
        if (wasPinned) {
          store.pinnedId = [...store.drafts].sort((a, b) =>
            (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0].id;
        }
        const d = pinnedDraft(store);
        return { updatedAt: d.updatedAt, pinnedId: store.pinnedId, drafts: metaList(store) };
      });
      if (res.last) return c.json({ error: "cannot delete the only draft" }, 400);
      if (res.missing) return c.json({ error: `no draft ${c.req.param("id")}` }, 404);
      await broadcastScript(c, pid, { updatedAt: res.updatedAt, clientId, pinnedId: res.pinnedId });
      return c.json({ ok: true, drafts: res.drafts, pinnedId: res.pinnedId });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // --- Specialist reviews (which script doctors have run) -------------------
  // Read the review state for the pinned draft: every specialist bucketed into
  // pending / stale / fresh, plus its latest pass. See lib/reviews.js for why
  // this is keyed by specialist and invalidated by an edit, not by a new draft.
  app.get("/api/script/reviews", async (c) => {
    const pid = c.get("projectId");
    try {
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      const state = reviewState(await readReviews(c.env, pid), {
        pinnedId: d.id,
        scriptUpdatedAt: d.updatedAt,
      });
      return c.json({
        specialists: SPECIALISTS,
        // The full roster definitions, so the Script Agents board renders every
        // name, label, lane, stage and icon from the shared source of truth
        // instead of hardcoding a table that drifts the next time a doctor is
        // added. `specialists` (ids only) stays for existing callers.
        roster: SPECIALIST_ROSTER,
        draftId: d.id,
        draftName: d.name,
        scriptUpdatedAt: d.updatedAt,
        // How big the draft is, in the same non-empty-block count the drafts
        // index reports — the board uses it to decide which stage of pass is
        // worth offering yet (scriptStage() in lib/specialists.ts).
        lines: countLines(d.doc),
        ...state,
      });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Deterministic screenplay lint over the pinned draft: the mechanical faults
  // (orphan dialogue, malformed sluglines, drifting character names) plus a
  // runtime estimate. Read-only and free — see lib/script-lint.js for why these
  // are a function rather than a sixteenth specialist. No broadcast: nothing
  // changed.
  app.get("/api/script/lint", async (c) => {
    try {
      const store = await readStore(c.env, c.get("projectId"));
      const d = pinnedDraft(store);
      return c.json({
        ok: true,
        draftId: d.id,
        draftName: d.name,
        scriptUpdatedAt: d.updatedAt,
        ...lintScript(elementsFromDoc(d.doc)),
      });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Record a specialist's pass over the pinned draft. Called by the doctor
  // itself (flue-agent's `record_script_review`) as its last act, so the record
  // reflects what it actually read: the draft + revision are snapshotted HERE
  // from the pinned draft rather than trusted from the body, which keeps a
  // careless caller from stamping a pass onto the wrong revision.
  app.post("/api/script/reviews", async (c) => {
    const pid = c.get("projectId");
    try {
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const { specialist, summary, findings, notes } = body || {};
      if (!isSpecialist(specialist)) {
        return c.json({ error: `unknown specialist "${specialist}" — expected one of ${SPECIALISTS.join(", ")}` }, 400);
      }
      const store = await readStore(c.env, pid);
      const d = pinnedDraft(store);
      const n = Number(findings);
      // The pass's findings as STRUCTURE, so a surface can list the actual
      // problems instead of only a count. Clamped by the same `cleanNotes` the
      // ledger normalizes with (24 max, severity coerced, strings clipped), and
      // a malformed member is DROPPED rather than 400-ing the call: a doctor
      // that formats one note badly should still get its pass logged.
      const cleaned = cleanNotes(notes);
      const entry = {
        at: nowIso(),
        draftId: d.id,
        draftName: d.name,
        scriptUpdatedAt: d.updatedAt,
        summary: typeof summary === "string" ? summary.slice(0, 600) : "",
        findings: Number.isFinite(n) ? Math.max(0, Math.round(n)) : null,
        notes: cleaned,
      };
      await recordReview(c.env, pid, specialist, entry);
      // The /api/* firehose skips /api/script (those writes get their own
      // targeted `script` channel), and this isn't a script edit — so announce it
      // on `data` by hand or the chat's suggestion cards and the Script tab's
      // review chips sit stale until the next unrelated write.
      broadcast(c.env, pid, "data", {
        path: "/api/script/reviews",
        resource: "script-reviews",
        clientId: c.req.header("x-client-id") || null,
        at: Date.now(),
      }, c.executionCtx);
      return c.json({ ok: true, specialist, entry });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // --- share link (LEGACY authed half, kept for the mobile app which still POSTs
  // here to get a script link; the web GUI now uses /api/share-config, and the
  // public viewer routes live in routes/share.js). One token, two surfaces — this
  // half only ever touches the SCRIPT surface, leaving `world` alone. The link
  // shows one chosen draft, read-only — the pinned draft by default, or whichever
  // version the author picks. The share page is served by this same worker's SPA,
  // so the link's origin is simply the request's own.
  const shareUrl = (c, token) => new URL(`/share/script/${token}`, c.req.url).toString();

  // Is sharing on, where does the link point, and which draft does it show?
  app.get("/api/script/share", async (c) => {
    try {
      const cfg = await readDoc(c.env, c.get("projectId"), SHARE_DOC, null);
      const scriptShared = isScriptShared(cfg);
      return c.json({
        shared: scriptShared,
        url: scriptShared ? shareUrl(c, cfg.token) : null,
        draftId: cfg?.draftId ?? null,
      });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Turn sharing on and/or repoint the link at a specific draft. Idempotent on
  // the token: an existing live token is returned as-is, so reopening the Share
  // dialog never silently rotates a link already sent out — but a `draftId` in
  // the body updates which version that same link shows.
  app.post("/api/script/share", async (c) => {
    const pid = c.get("projectId");
    try {
      let body = {};
      try { body = await c.req.json(); } catch { /* empty body = just ensure a token */ }
      // Validate the requested draft actually exists; an unknown id is ignored
      // (the viewer falls back to the pinned draft) rather than 400ing.
      let validDraft = null;
      if (typeof body.draftId === "string" && body.draftId) {
        const store = await readStore(c.env, pid);
        if (store.drafts.some((d) => d.id === body.draftId)) validDraft = body.draftId;
      }
      const { token, draftId } = await updateDoc(c.env, pid, SHARE_DOC, { token: null, draftId: null, script: false, world: false }, (cfg) => {
        if (!cfg.token) cfg.token = makeShareToken(pid);
        // Explicitly turn the SCRIPT surface on — that's what this endpoint means.
        cfg.script = true;
        if (validDraft) cfg.draftId = validDraft;
        return { token: cfg.token, draftId: cfg.draftId ?? null };
      });
      return c.json({ shared: true, url: shareUrl(c, token), draftId: draftId ?? null });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Turn SCRIPT sharing off. If the world is still shared the token stays alive
  // (only the script surface goes dark); otherwise the token is revoked and every
  // copy of the link dies. Also clears the chosen draft.
  app.delete("/api/script/share", async (c) => {
    try {
      await updateDoc(c.env, c.get("projectId"), SHARE_DOC, { token: null, draftId: null, script: false, world: false }, (cfg) => {
        if (!cfg.token) return { abort: true };
        cfg.script = false;
        cfg.draftId = null;
        if (!isWorldShared(cfg)) cfg.token = null;
        return {};
      });
      return c.json({ shared: false });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
