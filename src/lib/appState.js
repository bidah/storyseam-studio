// Tell the backend what the author is looking at, so the chat agent can stop
// asking "which shot?" while they're staring at MS-014.
//
// The agent shares the window with the GUI but has never been able to see it.
// This is the reporting half of that fix: every route change (and any tab that
// wants to) posts a POINTER — `{ view, path }`, ids, a short label — to
// `PUT /api/appstate`. The agent reads it back through its `view_screen` tool,
// which re-hydrates the live records from those ids (worker/src/routes/
// appstate.js). Nothing here should ever send a record: the server caps the body
// and rejects one, and a stale duplicate is exactly what `view_screen` exists to
// avoid.
//
// THIS IS TELEMETRY, NOT A FEATURE THE USER SEES. Three properties follow, and
// all three are load-bearing:
//
//   - Debounced + coalescing. Navigation fires on every route change and
//     selection can fire on every click; one PUT per burst is plenty, and each
//     write is a D1 row update. Partial reports merge server-side, so batching
//     a navigation and a selection into one body is safe.
//   - `keepalive`. The most valuable report is often the last one before the tab
//     closes or navigates away; without it the browser cancels that request.
//   - Failures are swallowed, always. A 4xx, an offline tab, a project the user
//     just lost access to — none of it may surface an error or reject into a
//     render path. The worst outcome of a failed report is that the agent asks a
//     question, which is exactly what it did before this existed.
import { useEffect } from "react";
import { onProjectChange } from "@/lib/projectFetch";

const ENDPOINT = "/api/appstate";
// Long enough to collapse a burst (a tab switch that also re-reports selection),
// short enough that the agent is never reading a screen the author left.
const DEBOUNCE_MS = 400;

let pending = null;
let timer = null;
// Consecutive identical reports are dropped. React re-runs effects on remount
// and on every project switch, and re-posting the same `{ view, path }` would be
// a write per remount for no new information.
let lastSent = "";

// The current project rides on the `x-project-id` header injected by the fetch
// shim, so the SAME body means something different after a project switch —
// clear the dedupe so the first report on the new project always lands.
onProjectChange(() => {
  lastSent = "";
});

function flush() {
  timer = null;
  const body = pending;
  pending = null;
  if (!body) return;
  const json = JSON.stringify(body);
  if (json === lastSent) return;
  lastSent = json;
  try {
    fetch(ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: json,
      keepalive: true,
    }).catch(() => {
      /* telemetry for the agent — a failed report must never reach the UI */
    });
  } catch {
    /* fetch itself can throw synchronously (keepalive body limits) — ignore */
  }
}

// Merge a patch into the pending report. The first call in a window schedules
// the flush and later calls ride it, so a burst costs one request carrying the
// newest values.
function report(patch) {
  pending = { ...(pending || {}), ...patch };
  if (timer) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

// `nav` is a pointer: `{ view, path }` plus whatever ids identify what's open on
// that tab (`shotId`, `cutV`, …). Pass `null` to clear it.
//
// `surface` is stamped on every report because the stored row is keyed per USER,
// not per device — this browser and that person's phone write the SAME row, and
// the last one to move wins. That is the behaviour we want (the agent should
// follow wherever the author actually is), but only if the snapshot says which
// surface it came from; otherwise a stale row is indistinguishable from a live
// one. The mobile app stamps `"mobile"` in mobile-app/src/lib/app-state.ts.
export function reportNavigation(nav) {
  report({ navigation: nav ? { surface: "web", ...nav } : null });
}

// `sel` is `{ kind, ids, label? }` — e.g. `{ kind: "shot", ids: ["MS-014"] }`.
// The server resolves kind+ids into the live records. Pass `null` to clear.
export function reportSelection(sel) {
  report({ selection: sel ?? null });
}

// Report `nav` whenever it changes. Serializing for the dependency lets callers
// pass a fresh object literal every render without re-reporting.
export function useReportNavigation(nav) {
  const key = JSON.stringify(nav ?? null);
  useEffect(() => {
    reportNavigation(nav ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS `nav`, compared by value
  }, [key]);
}
