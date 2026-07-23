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
import { getAgentModelSpecifier } from "@/lib/agentModel";
import { getFalKey } from "@/lib/falKey";

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

// The flue agent proxy lives at `/eve/*` (same-origin). Prompt sends go here, and
// they carry the picker's per-turn model as `x-flue-model`.
function isEve(url) {
  if (typeof url !== "string") return false;
  return (
    url.startsWith("/eve/") || url.startsWith(window.location.origin + "/eve/")
  );
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
      // Carry the picker's per-turn chat model on flue prompt sends. The flue
      // app whitelists it, so an out-of-range value is simply ignored.
      if (isEve(url)) headers.set("x-flue-model", getAgentModelSpecifier());
      // The user's own fal.ai key (localStorage-only BYOK — see lib/falKey.js)
      // rides per-request: our API reads x-fal-key for fal generations; agent
      // sends carry it as x-flue-fal-key so the flue worker can persist it into
      // the conversation's Durable Object for its render tools.
      const falKey = getFalKey();
      if (falKey) headers.set(isEve(url) ? "x-flue-fal-key" : "x-fal-key", falKey);
      // Send the Better Auth session cookie with every same-origin API call —
      // the `/eve/*` flue proxy relies on it to mint the per-user identity.
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
