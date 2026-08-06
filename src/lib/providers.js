// Render-provider selection: exactly ONE of the three generation backends
// (Higgsfield / fal.ai / Atlas Cloud) is in use at a time. Credentials for all
// three can be stored side by side; the selection decides which backend the
// composer and the agent render with. Selecting one deselects the others
// (radio semantics — there is never zero or two "on").
//
// Client-side only (localStorage, like the BYOK keys). The projectFetch shim
// translates the selection into per-request headers:
//   - `x-render-provider` — the selected provider (wins the catalog default;
//     the worker only offers the selected provider's models for NEW work),
//   - `x-disabled-providers` — the two non-selected ids (they leave the model
//     pickers; the worker still polls their in-flight jobs so switching
//     providers never strands a processing generation),
//   - stored BYOK keys ride regardless of selection (x-fal-key / x-atlas-key)
//     for exactly that reason,
//   - `/eve/*` agent sends carry the same as x-flue-* (persisted per
//     conversation in the flue DO to steer the agent's default backend).

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:providers";

export const PROVIDERS = [
  { id: "higgsfield", label: "Higgsfield", byok: false },
  { id: "fal", label: "fal.ai", byok: true },
  { id: "atlas", label: "Atlas Cloud", byok: true },
];
const IDS = PROVIDERS.map((p) => p.id);

// Higgsfield is the default selection (the sign-in itself is its credential).
// Tolerates the earlier `{ active, enabled }` stored shape — only `active`
// matters now.
function normalize(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return { active: IDS.includes(o.active) ? o.active : "higgsfield" };
}

let current = (() => {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
  catch { return normalize(null); }
})();
const listeners = new Set();

function save(next) {
  current = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  for (const fn of listeners) { try { fn(next); } catch { /* ignore */ } }
}

export function getProviderPrefs() {
  return current;
}

export function setActiveProvider(id) {
  if (!IDS.includes(id) || id === current.active) return;
  save({ active: id });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for the Settings panel / login gate.
export function useProviderPrefs() {
  return useSyncExternalStore(subscribe, getProviderPrefs);
}

// The two NON-selected ids for the x-disabled-providers header.
export function disabledProvidersCsv() {
  return IDS.filter((id) => id !== current.active).join(",");
}

// ── Onboarding skip ──────────────────────────────────────────────────────────
// The render-provider setup is no longer a hard wall: a new user can dismiss the
// connect/key screen and jump straight into the app (chat, script, planning).
// The nudge to connect a provider then moves to the point of use — a modal when
// they try to generate in the GUI, and a settings card the agent draws when
// asked to render. This flag (localStorage) remembers the dismissal so the gate
// doesn't ask again; the provider is still fully editable in Settings.
const SKIP_KEY = "shot-studio:setupSkipped";

let skipped = (() => {
  try { return localStorage.getItem(SKIP_KEY) === "1"; } catch { return false; }
})();
const skipListeners = new Set();

export function getSetupSkipped() {
  return skipped;
}

export function setSetupSkipped(v = true) {
  const next = !!v;
  if (next === skipped) return;
  skipped = next;
  try {
    if (next) localStorage.setItem(SKIP_KEY, "1");
    else localStorage.removeItem(SKIP_KEY);
  } catch { /* private mode */ }
  for (const fn of skipListeners) { try { fn(next); } catch { /* ignore */ } }
}

export function useSetupSkipped() {
  return useSyncExternalStore(
    (fn) => { skipListeners.add(fn); return () => skipListeners.delete(fn); },
    getSetupSkipped,
  );
}
