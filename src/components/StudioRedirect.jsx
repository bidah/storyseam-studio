import { Navigate, useLocation } from "react-router";
import { HOME_PATH } from "@/lib/home";
import { getProjectId } from "@/lib/projectFetch";
import { toStudio } from "@/lib/studioNav";

// The bare studio paths (/world, /editor, /settings#…) → the current project's
// /p/<id>/… url, hash and search kept. A component rather than a loader on
// purpose: a loader's request url has no hash, and the cross-tab jumps
// (`/episode#ep-<id>`, `/world#locations`) would lose their anchor.
//
// No project known (a fresh browser, signed out) → home: the prompt box makes
// the project, and the Film's page sets it before anything reaches here.
export function StudioRedirect() {
  const { pathname, search, hash } = useLocation();
  const pid = getProjectId();
  if (!pid) return <Navigate to={HOME_PATH} replace />;
  return <Navigate to={toStudio(pid, `${pathname}${search}${hash}`)} replace />;
}

export default StudioRedirect;
