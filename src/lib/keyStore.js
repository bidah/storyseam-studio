// Shared store factory for the BYOK provider keys (fal.ai / Atlas Cloud) with
// a pluggable persistence backend:
//   • web     — localStorage, synchronous, byte-for-byte the old behavior.
//   • desktop — the Electron safeStorage vault (OS-keychain-encrypted) via the
//     preload's `desktop.vault`, with a ONE-TIME migration of any key found in
//     localStorage (then removed — nothing key-shaped stays there).
// Reads stay synchronous either way (the projectFetch shim stamps keys on every
// request): the current value lives in memory; the desktop backend hydrates it
// through `init()`, awaited before first render (see desktop-bootstrap.js).
import { useSyncExternalStore } from "react";

export function webBackend(storageKey) {
  return {
    kind: "web",
    load() {
      try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
    },
    save(value) {
      try {
        if (value) localStorage.setItem(storageKey, value);
        else localStorage.removeItem(storageKey);
      } catch { /* private mode — key lives for this tab only */ }
    },
  };
}

export function vaultBackend(vault, vaultName, storageKey) {
  return {
    kind: "desktop",
    // Hydrate from the vault; migrate a legacy localStorage key on first run.
    async init() {
      let value = "";
      try { value = (await vault.get(vaultName)) || ""; } catch { value = ""; }
      let legacy = "";
      try { legacy = localStorage.getItem(storageKey) || ""; } catch { legacy = ""; }
      if (!value && legacy) {
        try {
          await vault.set(vaultName, legacy);
          value = legacy;
        } catch { /* keychain unavailable — keep running with the legacy value */ }
      }
      if (legacy) {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }
      return value;
    },
    save(value) {
      vault.set(vaultName, value).catch(() => { /* keychain hiccup — in-memory value still works */ });
    },
  };
}

export function pickBackend(storageKey, vaultName, w = typeof window !== "undefined" ? window : undefined) {
  const vault = w?.desktop?.vault;
  return vault ? vaultBackend(vault, vaultName, storageKey) : webBackend(storageKey);
}

export function createKeyStore(storageKey, vaultName, backend = pickBackend(storageKey, vaultName)) {
  let current = backend.kind === "web" ? backend.load() : "";
  const listeners = new Set();
  const emit = () => {
    for (const fn of listeners) {
      try { fn(current); } catch { /* ignore */ }
    }
  };

  // Async hydration for backends that need it (desktop). No-op on web.
  async function init() {
    if (!backend.init) return;
    current = await backend.init();
    emit();
  }

  function get() {
    return current;
  }

  function set(key) {
    const next = String(key || "").trim();
    if (next === current) return;
    current = next;
    backend.save(next);
    emit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Reactive read for gates/forms — re-renders when the key changes in this tab.
  function use() {
    return useSyncExternalStore(subscribe, get);
  }

  return { init, get, set, clear: () => set(""), subscribe, use, backendKind: backend.kind };
}
