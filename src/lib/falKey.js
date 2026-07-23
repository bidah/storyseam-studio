// The user's own fal.ai API key (BYOK). Lives ONLY in this browser's
// localStorage — it is never written to the server's D1/KV/R2. It reaches the
// backends per-request instead: the projectFetch shim stamps it as `x-fal-key`
// on our own API calls and as `x-flue-fal-key` on `/eve/*` agent sends (the flue
// worker keeps it in the conversation's Durable Object so render tools can use
// it mid-run; it is deleted with the conversation).
//
// The key is MANDATORY after login (see the gate in components/Login.jsx) and
// editable on the Settings page.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:falKey";

let current = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
})();
const listeners = new Set();

export function getFalKey() {
  return current;
}

export function setFalKey(key) {
  const next = String(key || "").trim();
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode — key lives for this tab only */ }
  for (const fn of listeners) { try { fn(next); } catch { /* ignore */ } }
}

export function clearFalKey() {
  setFalKey("");
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for gates/forms — re-renders when the key changes in this tab.
export function useFalKey() {
  return useSyncExternalStore(subscribe, getFalKey);
}
