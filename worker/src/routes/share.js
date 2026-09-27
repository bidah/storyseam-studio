// PUBLIC share surface — the read-only project view behind a share link.
//
// This prefix is exempt from the ownership middleware (see the isData chain in
// index.js): a share-link viewer has no session and no project header. The
// token IS the credential — it names a project (lib/share-token.js) and each
// route verifies it against that project's `script-share` doc, so a revoked or
// fabricated token dies here with a 404. Everything is a GET; nothing under
// /api/share may ever mutate.
//
// One token, two independently-toggled surfaces: the SCRIPT and the written
// WORLD. `script-share` holds `{ token, draftId, script, world }`; a viewer sees
// only the tabs the author enabled (isScriptShared / isWorldShared).
import { readDoc } from "../lib/docs.js";
import { readStore, pinnedDraft, countLines } from "../lib/script-store.js";
import { buildSharedWorld } from "./world.js";
import {
  shareTokenProject,
  shareTokensMatch,
  isScriptShared,
  isWorldShared,
} from "../lib/share-token.js";
import { filmDownloadName, resolveFilmShare } from "../lib/film-share.js";
import { mediaKey, streamKey } from "../lib/media.js";

// Doc holding a project's active share token, which surfaces are on, and which
// script draft the link points at ({ token, draftId, script, world }). Written
// only by the authed routes (routes/share-config.js + the legacy /api/script/share
// in routes/script.js). A null `draftId` (or one whose draft was since deleted)
// resolves to the PINNED draft, so old links never 404 on a deleted version.
export const SHARE_DOC = "script-share";

// Resolve + verify a presented token against its project's share config. Returns
// { pid, cfg } on a real, live token, else null. One indistinguishable failure
// path for malformed, revoked and never-issued tokens — a prober learns nothing.
async function resolveShare(env, token) {
  const pid = shareTokenProject(token);
  if (!pid) return null;
  const cfg = await readDoc(env, pid, SHARE_DOC, null);
  if (!cfg?.token || !(await shareTokensMatch(cfg.token, token))) return null;
  return { pid, cfg };
}

// `attachment` with an ASCII fallback name and the real (UTF-8) one — a header
// value must be ASCII, and a title may not be.
const attachment = (name) =>
  `attachment; filename="${name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "") || "story.mp4"}"; ` +
  `filename*=UTF-8''${encodeURIComponent(name)}`;

export function registerShare(app) {
  // A shared FILM (lib/film-share.js) — the public /watch/:token page. The
  // manifest names the Film and where its video is; the video streams through
  // the token (range requests for seeking), and `?download=1` answers it as an
  // attachment named after the Film. A revoked or fabricated token, or a Film
  // with no finished video, is one indistinguishable 404.
  app.get("/api/share/film/:token", async (c) => {
    const r = await resolveFilmShare(c.env, c.req.param("token"));
    if (!r) return c.json({ error: "This share link is no longer available" }, 404);
    const base = `/api/share/film/${encodeURIComponent(c.req.param("token"))}/video`;
    return c.json({
      title: r.film.title || null,
      idea: r.film.idea || null,
      seconds: r.film.seconds || null,
      engine: r.job.engine || "director",
      completedAt: r.job.updatedAt || null,
      videoUrl: base,
      downloadUrl: `${base}?download=1`,
      fileName: filmDownloadName(r.film),
    });
  });

  app.get("/api/share/film/:token/video", async (c) => {
    const r = await resolveFilmShare(c.env, c.req.param("token"));
    if (!r) return c.text("This share link is no longer available", 404);
    const download = c.req.query("download") === "1";
    return streamKey(c.env, mediaKey(r.pid, "director", r.file), c.req.header("range"), {
      ifNoneMatch: c.req.header("if-none-match"),
      // Revocable: never let a shared copy outlive the link in a cache.
      cacheControl: "private, max-age=300",
      extraHeaders: {
        "content-type": "video/mp4",
        ...(download ? { "content-disposition": attachment(filmDownloadName(r.film)) } : {}),
      },
    });
  });

  // Manifest: which surfaces this link exposes, so the unified /share/:token page
  // knows which tabs to draw before fetching either payload. 404 when the token
  // is bad OR every surface is off (a fully-revoked link is indistinguishable
  // from a fabricated one).
  app.get("/api/share/:token", async (c) => {
    const gone = () => c.json({ error: "This share link is no longer available" }, 404);
    const r = await resolveShare(c.env, c.req.param("token"));
    if (!r) return gone();
    const script = isScriptShared(r.cfg);
    const world = isWorldShared(r.cfg);
    if (!script && !world) return gone();
    return c.json({ script, world });
  });

  // Resolve a share link to a read-only projection of the shared script. The
  // viewer can switch between EVERY draft in the store — so the response carries
  // the full draft list (id/name/lineCount/updatedAt, no proposals) plus the
  // content of ONE draft: the one named by `?draftId=`, else the author's chosen
  // default (the pinned draft when none was chosen or it was since deleted).
  // Deliberately NOT buildScriptView: proposals, sign-off and reviews stay the
  // author's business.
  app.get("/api/share/script/:token", async (c) => {
    const gone = () => c.json({ error: "This share link is no longer available" }, 404);
    const r = await resolveShare(c.env, c.req.param("token"));
    // A live token whose SCRIPT surface is off (world-only share) 404s here just
    // like a revoked one.
    if (!r || !isScriptShared(r.cfg)) return gone();
    const { pid, cfg } = r;
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

  // Resolve a share link to the read-only written world (buildSharedWorld strips
  // it to public, ungated-media shape). 404 when the WORLD surface is off.
  app.get("/api/share/world/:token", async (c) => {
    const gone = () => c.json({ error: "This share link is no longer available" }, 404);
    const r = await resolveShare(c.env, c.req.param("token"));
    if (!r || !isWorldShared(r.cfg)) return gone();
    return c.json(await buildSharedWorld(c.env, r.pid));
  });
}
