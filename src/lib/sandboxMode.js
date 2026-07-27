// Sandbox selection: what the agent's bash / skill execution runs on.
//
//   "memory"  — flue's built-in virtual filesystem. DEFAULT. Wiped between
//               messages, so the agent can't write a file in one turn and read
//               it in the next. Free and instant, and enough for nearly all of
//               the pipeline, which carries state through the typed tools (D1)
//               and R2 rather than through files.
//   "daytona" — a real Linux container that keeps its files for the whole
//               conversation. Opt-in: it costs money per chat and the first
//               message pays a container cold-start.
//
// Client-side only (localStorage, like lib/providers.js / lib/searchProviders.js).
// The projectFetch shim sends the selection on `/eve/*` prompt sends as
// `x-flue-sandbox`; the flue worker persists it into the conversation's Durable
// Object (flue-agent/src/lib/sandbox-prefs.ts) and the agent initializer decides
// per turn whether to attach a container. Agent-only — no `/api/*` route reads it.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:sandboxMode";

export const SANDBOX_MODES = [
  {
    id: "memory",
    label: "In-memory",
    blurb:
      "A virtual filesystem that resets between messages. Free, instant, and fine for everything that moves through the agent's tools.",
  },
  {
    id: "daytona",
    label: "Daytona container",
    blurb:
      "A real Linux box whose files survive the whole conversation — for multi-step work that has to write something now and read it back later. Billed per conversation; the first message waits for the container to boot.",
  },
];
const IDS = SANDBOX_MODES.map((m) => m.id);

export const DEFAULT_SANDBOX_MODE = "memory";

function normalize(raw) {
  return IDS.includes(raw) ? raw : DEFAULT_SANDBOX_MODE;
}

let current = (() => {
  try { return normalize(localStorage.getItem(STORAGE_KEY)); }
  catch { return DEFAULT_SANDBOX_MODE; }
})();
const listeners = new Set();

export function getSandboxMode() {
  return current;
}

export function setSandboxMode(id) {
  if (!IDS.includes(id) || id === current) return;
  current = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  for (const fn of listeners) { try { fn(id); } catch { /* ignore */ } }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for the Settings panel.
export function useSandboxMode() {
  return useSyncExternalStore(subscribe, getSandboxMode);
}
