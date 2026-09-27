// Project-aware navigation inside the studio shell.
//
// The studio lives at `/p/:projectId/<view>` (lib/home.js). A component under
// RootLayout that wants to move to another tab of the SAME project builds the
// path with these rather than a bare `/world`: a bare path still works (the
// catch-all StudioRedirect sends it to the current project), but costs a redirect
// hop and a history entry. Outside a `/p/:projectId` match the helpers fall back
// to the bare path, so a shared component renders the same everywhere.
import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { studioPath } from "@/lib/home";

/** `/view#hash?search` (bare) → this project's studio path for it. */
export function toStudio(projectId, bare) {
  const s = String(bare || "");
  if (!projectId) return s.startsWith("/") ? s : `/${s}`;
  if (s.startsWith("/p/")) return s;
  const m = /^\/?([^?#]*)(.*)$/.exec(s);
  return studioPath(projectId, m ? m[1] : s, m ? m[2] : "");
}

/** `studioTo("/world#locations")` → `/p/<id>/world#locations` for the URL's project. */
export function useStudioPath() {
  const { projectId } = useParams();
  return useCallback((bare) => toStudio(projectId, bare), [projectId]);
}

/** `navigate("/editor")` scoped to the URL's project. */
export function useStudioNavigate() {
  const navigate = useNavigate();
  const to = useStudioPath();
  return useCallback((bare, opts) => navigate(to(bare), opts), [navigate, to]);
}
