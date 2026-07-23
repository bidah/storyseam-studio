// The user's own Atlas Cloud API key (BYOK) — the exact same model as the fal
// key (src/lib/falKey.js): it lives ONLY in this browser's localStorage, never
// in the server's D1/KV/R2, and reaches the backends per-request via the
// projectFetch shim (`x-atlas-key` on our own API calls, `x-flue-atlas-key` on
// `/eve/*` agent sends — the flue worker keeps it in the conversation's Durable
// Object so render tools can use it mid-run).
//
// Editable on the Settings page (Providers panel); the post-login key gate in
// components/Login.jsx accepts either a fal key or an Atlas key.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:atlasKey";

let current = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
})();
const listeners = new Set();

export function getAtlasKey() {
  return current;
}

export function setAtlasKey(key) {
  const next = String(key || "").trim();
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode — key lives for this tab only */ }
  for (const fn of listeners) { try { fn(next); } catch { /* ignore */ } }
}

export function clearAtlasKey() {
  setAtlasKey("");
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for gates/forms — re-renders when the key changes in this tab.
export function useAtlasKey() {
  return useSyncExternalStore(subscribe, getAtlasKey);
}
