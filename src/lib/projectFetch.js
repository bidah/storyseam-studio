// Project-scoped networking.
//
// The app now has multiple projects; the server figures out which one a request
// belongs to from an `x-project-id` header (for fetch) or a `?projectId=` query
// param (for EventSource / media element loads that can't set headers). Rather
// than thread the id through ~35 fetch call sites, we install a one-time shim
// over `window.fetch` and `window.EventSource` that injects the current project
// id into every SAME-ORIGIN request (our own Express API + media). Cross-origin
// requests (e.g. the Cloudflare Worker upload URL) are left untouched so they
// don't trip CORS.

import { CLIENT_ID } from "@/lib/clientId";
import { getAgentModel } from "@/lib/agentModel";

const STORAGE_KEY = "shot-studio:projectId";

let currentProjectId = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
})();
const listeners = new Set();

export function getProjectId() {
  return currentProjectId;
}

export function setProjectId(id) {
  if (!id || id === currentProjectId) return;
  currentProjectId = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  for (const fn of listeners) { try { fn(id); } catch { /* ignore */ } }
}

export function onProjectChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A request is "local" (to our own server) if it's a root-relative path or
// points at the current origin.
function isLocal(url) {
  if (typeof url !== "string") return false;
  return url.startsWith("/") || url.startsWith(window.location.origin);
}

let installed = false;

// Patch fetch + EventSource once. Call before the app renders (see main.jsx).
export function installProjectScope() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input && input.url;
    if (isLocal(url)) {
      const base = init && init.headers ? init.headers : (typeof input !== "string" && input ? input.headers : undefined);
      const headers = new Headers(base || {});
      if (currentProjectId) headers.set("x-project-id", currentProjectId);
      // Tag this tab's own writes so the live-sync firehose can tell them apart
      // from the chat agent's writes (only the latter trigger a refetch).
      headers.set("x-client-id", CLIENT_ID);
      // Tell the eve agent which model the picker has selected. Only the /eve
      // proxy path cares (the Worker API ignores it), so scope it there. Read
      // fresh per request so switching the picker applies to the next turn.
      const path = url.startsWith("/") ? url : url.slice(window.location.origin.length);
      if (path.startsWith("/eve")) headers.set("x-eve-model", getAgentModel());
      // Send the Better Auth session cookie with every same-origin API call.
      init = { credentials: "include", ...(init || {}), headers };
    }
    return origFetch(input, init);
  };

  const OrigES = window.EventSource;
  if (OrigES) {
    const Patched = function (url, config) {
      const pid = currentProjectId;
      if (pid && typeof url === "string" && isLocal(url)) {
        url += (url.includes("?") ? "&" : "?") + "projectId=" + encodeURIComponent(pid);
      }
      return new OrigES(url, config);
    };
    Patched.prototype = OrigES.prototype;
    Patched.CONNECTING = OrigES.CONNECTING;
    Patched.OPEN = OrigES.OPEN;
    Patched.CLOSED = OrigES.CLOSED;
    window.EventSource = Patched;
  }
}
