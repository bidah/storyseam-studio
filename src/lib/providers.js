// Render-provider preferences: which of the three generation backends
// (Higgsfield / fal.ai / Atlas Cloud) are ENABLED, and which one is ACTIVE —
// the default backend whose default model wins when no explicit model is
// picked. Credentials can exist for all three at once; the toggles decide
// which ones this browser actually uses.
//
// Client-side only (localStorage, like the BYOK keys). The projectFetch shim
// translates the prefs into per-request headers:
//   - a disabled provider's key is simply not sent, and the provider id rides
//     in `x-disabled-providers` (so the worker also ignores its env-fallback
//     key / the Higgsfield OAuth token),
//   - the active provider rides as `x-render-provider` (wins the catalog
//     default in /api/visual-world/models),
//   - `/eve/*` agent sends carry the same as `x-flue-disabled-providers` /
//     `x-flue-render-provider` (persisted per conversation in the flue DO).

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:providers";

export const PROVIDERS = [
  { id: "higgsfield", label: "Higgsfield", byok: false },
  { id: "fal", label: "fal.ai", byok: true },
  { id: "atlas", label: "Atlas Cloud", byok: true },
];
const IDS = PROVIDERS.map((p) => p.id);

// Higgsfield stays the default active provider — matches the pre-prefs
// behavior (catalog default = Nano Banana Pro via Higgsfield when signed in).
function normalize(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const en = o.enabled && typeof o.enabled === "object" ? o.enabled : {};
  const enabled = Object.fromEntries(IDS.map((id) => [id, en[id] !== false]));
  let active = IDS.includes(o.active) ? o.active : "higgsfield";
  if (!enabled[active]) active = IDS.find((id) => enabled[id]) || "higgsfield";
  return { active, enabled };
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

// Making a provider active also enables it.
export function setActiveProvider(id) {
  if (!IDS.includes(id)) return;
  save(normalize({ active: id, enabled: { ...current.enabled, [id]: true } }));
}

// Disabling the active provider hands "active" to the first remaining enabled
// one; disabling the LAST enabled provider is a no-op (something must render).
export function setProviderEnabled(id, on) {
  if (!IDS.includes(id)) return;
  const enabled = { ...current.enabled, [id]: !!on };
  if (!IDS.some((x) => enabled[x])) return;
  save(normalize({ active: current.active, enabled }));
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for the Settings panel.
export function useProviderPrefs() {
  return useSyncExternalStore(subscribe, getProviderPrefs);
}

// "fal,atlas"-style value for the x-disabled-providers header ("" = none).
export function disabledProvidersCsv() {
  return IDS.filter((id) => !current.enabled[id]).join(",");
}
