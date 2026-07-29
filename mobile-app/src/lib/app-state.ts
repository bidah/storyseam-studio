// Tell the backend what the author is looking at — the RN port of the web
// app's src/lib/appState.js.
//
// The chat agent can't see the screen, so it asks "which shot?" while the
// author is staring at MS-014. Every navigation posts a POINTER (`{ view, path,
// … ids }`) to `PUT /api/appstate`; the agent reads it back through its
// `view_screen` tool, which re-hydrates the live records from those ids
// (worker/src/routes/appstate.js). Never send a record — the server caps the
// body and rejects one, and a stale duplicate is the exact thing `view_screen`
// exists to avoid.
//
// WHY MOBILE HAS TO DO THIS TOO, not just as parity: the stored row is keyed per
// USER (`appstate:<userId>`), so one person's phone and browser share it. If
// only the web reported, then the moment that person picked up their phone the
// agent would answer "this shot" with whatever tab their laptop was left on —
// confidently, and wrong. A surface that doesn't report is worse than one the
// agent knows nothing about. That's also why every report carries `surface`:
// the snapshot should say where the author actually was.
//
// THIS IS TELEMETRY, NOT A FEATURE THE USER SEES:
//
//   - Debounced + coalescing. Navigation fires on every route change; one PUT
//     per burst is plenty, and each write is a D1 row update. Partial reports
//     merge server-side, so batching navigation and selection into one body is
//     safe.
//   - Failures are swallowed, always. Offline, a 401 after sign-out, a project
//     the user just lost access to — none of it may surface an error or reject
//     into a render path. The worst outcome of a failed report is that the agent
//     asks a question, which is what it did before this existed.
import { useEffect } from 'react';
import { apiFetch } from './api';
import { useProjectStore } from './project';

const ENDPOINT = '/api/appstate';
// Long enough to collapse a burst (a tab switch that also re-reports selection),
// short enough that the agent is never reading a screen the author left.
const DEBOUNCE_MS = 400;

type Report = { navigation?: unknown; selection?: unknown };

let pending: Report | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Consecutive identical reports are dropped. Effects re-run on remount and on
// every project switch, and re-posting the same `{ view, path }` would be a
// write per remount for no new information.
let lastSent = '';

// The project rides on the `x-project-id` header the fetch shim injects, so the
// SAME body means something different after a project switch — clear the dedupe
// so the first report on the new project always lands.
useProjectStore.subscribe(() => {
  lastSent = '';
});

function flush() {
  timer = null;
  const body = pending;
  pending = null;
  if (!body) return;
  const json = JSON.stringify(body);
  if (json === lastSent) return;
  lastSent = json;
  apiFetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: json,
  }).catch(() => {
    /* telemetry for the agent — a failed report must never reach the UI */
  });
}

// Merge a patch into the pending report. The first call in a window schedules
// the flush and later calls ride it, so a burst costs one request carrying the
// newest values.
function report(patch: Report) {
  pending = { ...(pending || {}), ...patch };
  if (timer) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

// `nav` is a pointer: `{ view, path, surface }` plus whatever ids identify
// what's open (`shotId`, `bundleId`, …). Pass `null` to clear it.
export function reportNavigation(nav: Record<string, unknown> | null) {
  report({ navigation: nav ? { surface: 'mobile', ...nav } : null });
}

// `sel` is `{ kind, ids, label? }` — e.g. `{ kind: "shot", ids: ["MS-014"] }`.
// The server resolves kind+ids into the live records. Pass `null` to clear.
export function reportSelection(sel: Record<string, unknown> | null) {
  report({ selection: sel ?? null });
}

// Report `nav` whenever it changes. Serializing for the dependency lets callers
// pass a fresh object literal every render without re-reporting.
export function useReportNavigation(nav: Record<string, unknown> | null) {
  const key = JSON.stringify(nav ?? null);
  useEffect(() => {
    reportNavigation(nav ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS `nav`, by value
  }, [key]);
}
