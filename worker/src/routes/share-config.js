// AUTHED share management — the author's half of project sharing (the public,
// no-session read surface lives in routes/share.js). One token per project drives
// two independently-toggled surfaces: the SCRIPT (with a chosen draft) and the
// written WORLD. Both are stored in the `script-share` doc as
// `{ token, draftId, script, world }`; enabling either mints the token, disabling
// both revokes it (killing every copy of the link).
//
// Path is `/api/share-config`, NOT under the exempt `/api/share/` prefix — so it
// runs behind the ownership middleware (index.js) like every other authed route.
import { readDoc, updateDoc } from "../lib/docs.js";
import { readStore, pinnedDraft, countLines } from "../lib/script-store.js";
import { SHARE_DOC } from "./share.js";
import { makeShareToken, isScriptShared, isWorldShared } from "../lib/share-token.js";

// The link's origin is the request's own — the SPA that renders /share/* is
// served by this same worker. `tab` deep-links straight to one surface's tab.
const shareUrl = (c, token, tab) => {
  const u = new URL(`/share/${token}`, c.req.url);
  if (tab) u.searchParams.set("tab", tab);
  return u.toString();
};

// The full view the Share dialog renders from — current config, deep links, and
// the draft list it needs to drive the script version picker (so the dialog is
// self-contained no matter which tab opened it).
async function shareView(c, pid, cfg) {
  const token = cfg?.token || null;
  const script = isScriptShared(cfg);
  const world = isWorldShared(cfg);
  const store = await readStore(c.env, pid);
  const pinnedId = pinnedDraft(store)?.id || null;
  return {
    token,
    script,
    world,
    draftId: cfg?.draftId ?? null,
    url: token ? shareUrl(c, token) : null,
    scriptUrl: token && script ? shareUrl(c, token, "script") : null,
    worldUrl: token && world ? shareUrl(c, token, "world") : null,
    pinnedId,
    drafts: store.drafts.map((d) => ({
      id: d.id,
      name: d.name,
      lineCount: countLines(d.doc),
      pinned: d.id === pinnedId,
    })),
  };
}

export function registerShareConfig(app) {
  // Current sharing state + everything the dialog needs to render.
  app.get("/api/share-config", async (c) => {
    const pid = c.get("projectId");
    try {
      const cfg = (await readDoc(c.env, pid, SHARE_DOC, null)) || { token: null };
      return c.json(await shareView(c, pid, cfg));
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Toggle either surface and/or repoint the script link at a draft. Enabling a
  // surface with no token mints one; disabling BOTH revokes the token entirely.
  // Idempotent on the token — an existing live link is never silently rotated by
  // reopening the dialog.
  app.put("/api/share-config", async (c) => {
    const pid = c.get("projectId");
    try {
      let body = {};
      try { body = await c.req.json(); } catch { /* empty body = read-through */ }

      // Validate the requested draft actually exists; an unknown id is ignored
      // (the viewer falls back to the pinned draft) rather than 400ing.
      let validDraft = null;
      if (typeof body.draftId === "string" && body.draftId) {
        const store = await readStore(c.env, pid);
        if (store.drafts.some((d) => d.id === body.draftId)) validDraft = body.draftId;
      }

      const cfg = await updateDoc(
        c.env, pid, SHARE_DOC,
        { token: null, draftId: null, script: false, world: false },
        (cur) => {
          // Effective state BEFORE this edit (handles a legacy `{token,draftId}`
          // doc, where an absent `script` flag on a live token means shared).
          let script = isScriptShared(cur);
          let world = isWorldShared(cur);
          if (typeof body.script === "boolean") script = body.script;
          if (typeof body.world === "boolean") world = body.world;
          if (validDraft) cur.draftId = validDraft;
          if (script || world) {
            if (!cur.token) cur.token = makeShareToken(pid);
            cur.script = script;
            cur.world = world;
          } else {
            // Nothing shared any more — revoke the token so old links die.
            cur.token = null;
            cur.draftId = null;
            cur.script = false;
            cur.world = false;
          }
          return { ...cur };
        },
      );
      return c.json(await shareView(c, pid, cfg));
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
