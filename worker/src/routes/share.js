// PUBLIC share surface — the read-only script view behind a share link.
//
// This prefix is exempt from the ownership middleware (see the isData chain in
// index.js): a share-link viewer has no session and no project header. The
// token IS the credential — it names a project (lib/share-token.js) and the
// route verifies it against that project's `script-share` doc, so a revoked or
// fabricated token dies here with a 404. Everything is a GET; nothing under
// /api/share may ever mutate.
import { readDoc } from "../lib/docs.js";
import { readStore, pinnedDraft, countLines } from "../lib/script-store.js";
import { shareTokenProject, shareTokensMatch } from "../lib/share-token.js";

// Doc holding a project's active share token and which draft it points at
// ({ token, draftId } — either may be null). Written only by the authed
// /api/script/share routes in routes/script.js. A null `draftId` (or one whose
// draft was since deleted) resolves to the PINNED draft, so old links never 404
// on a deleted version.
export const SHARE_DOC = "script-share";

export function registerShare(app) {
  // Resolve a share link to a read-only projection of the shared script. The
  // viewer can switch between EVERY draft in the store — so the response carries
  // the full draft list (id/name/lineCount/updatedAt, no proposals) plus the
  // content of ONE draft: the one named by `?draftId=`, else the author's chosen
  // default (the pinned draft when none was chosen or it was since deleted).
  // Deliberately NOT buildScriptView: proposals, sign-off and reviews stay the
  // author's business.
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

    // The default draft the link lands on: the author's chosen one, else pinned.
    const fallback = (cfg.draftId && store.drafts.find((x) => x.id === cfg.draftId)) || pinnedDraft(store);
    // Which draft's content to return — the requested one if it exists, else the
    // default. An unknown/stale id quietly resolves to the default, never 404s.
    const reqId = c.req.query("draftId");
    const d = (reqId && store.drafts.find((x) => x.id === reqId)) || fallback;

    return c.json({
      drafts: store.drafts.map((x) => ({
        id: x.id,
        name: x.name,
        lineCount: countLines(x.doc),
        updatedAt: x.updatedAt || null,
      })),
      draftId: d.id,
      title: d.title || "",
      doc: d.doc ?? null,
      updatedAt: d.updatedAt || null,
    });
  });
}
