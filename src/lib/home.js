// Where a signed-in author lands, and how the studio shell is reached.
//
// The product IS the text-to-story page: a prompt in, a Film back (`/`, with
// the fal H3 Director / Seedance 2.5 Gen mode). The studio (header, tabs,
// agent panel — RootLayout) is reached ONLY through a Film's project:
// `/p/:projectId/<view>` (`studioPath`). The project is in the URL, so a
// reload, a shared link or a tab switch lands on the same project's studio —
// the URL is the state. Every BARE studio path (`/world`, `/editor`, …) still
// exists so old links and the agent's `navigate` keep working: it redirects to
// the current project's `/p/...` url when one is known, else home.
export const HOME_PATH = "/";
export const STUDIO_HIDDEN = true;

/** The default landing after sign-in, when no `?next=` names one. */
export const AFTER_SIGN_IN = STUDIO_HIDDEN ? HOME_PATH : "/world";

/** The studio's url prefix for one project. */
export const STUDIO_PREFIX = "/p";

/** The studio, on one project: `/p/<projectId>/<view>` (+ hash/search). */
export function studioPath(projectId, view = "world", suffix = "") {
  const v = String(view || "").replace(/^\/+/, "");
  return `${STUDIO_PREFIX}/${encodeURIComponent(projectId)}/${v}${suffix || ""}`;
}

/** `/p/<id>/rest` → { projectId, rest: "/rest" } | null when not a studio url. */
export function parseStudioPath(pathname) {
  const m = /^\/p\/([^/]+)(\/.*)?$/.exec(String(pathname || ""));
  if (!m) return null;
  let projectId = m[1];
  try { projectId = decodeURIComponent(projectId); } catch { /* keep raw */ }
  return { projectId, rest: m[2] || "/" };
}
