// PUBLIC share surface — the read-only script view behind a share link.
//
// This prefix is exempt from the ownership middleware (see the isData chain in
// index.js): a share-link viewer has no session and no project header. The
// token IS the credential — it names a project (lib/share-token.js) and the
// route verifies it against that project's `script-share` doc, so a revoked or
// fabricated token dies here with a 404. Everything is a GET; nothing under
// /api/share may ever mutate.
import { readDoc } from "../lib/docs.js";
import { readStore, pinnedDraft } from "../lib/script-store.js";
import { shareTokenProject, shareTokensMatch } from "../lib/share-token.js";

// Doc holding a project's active share token ({ token } or { token: null }).
// Written only by the authed /api/script/share routes in routes/script.js.
export const SHARE_DOC = "script-share";

export function registerShare(app) {
  // Resolve a share link to a minimal read-only projection of the PINNED
  // draft. Deliberately NOT buildScriptView: drafts, proposals, sign-off and
  // reviews are the author's business, not a link viewer's.
  app.get("/api/share/script/:token", async (c) => {
    const token = c.req.param("token");
    const pid = shareTokenProject(token);
    // One indistinguishable 404 for malformed, revoked, and never-issued
    // tokens — a prober learns nothing about which projects exist.
    const gone = () => c.json({ error: "This share link is no longer available" }, 404);
    if (!pid) return gone();
    const cfg = await readDoc(c.env, pid, SHARE_DOC, null);
    if (!cfg?.token || !(await shareTokensMatch(cfg.token, token))) return gone();
    const store = await readStore(c.env, pid);
    const d = pinnedDraft(store);
    return c.json({ title: d.title || "", doc: d.doc ?? null, updatedAt: d.updatedAt || null });
  });
}
