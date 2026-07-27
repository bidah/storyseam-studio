import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// The user's own web-search API keys (BYOK) — Exa and Firecrawl. RN port of the
// web src/lib/searchKeys.js, same model as lib/fal-key.ts: device-only
// (expo-secure-store → Keychain / Keystore), never written to our D1/KV/R2. They
// reach the agent per-request — the fetch shim stamps them on `/eve/*` sends as
// `x-flue-exa-key` / `x-flue-firecrawl-key` and the flue worker keeps them in the
// conversation's Durable Object so the web_search / fetch_url tools can use them
// mid-run.
//
// Unlike the render keys these are OPTIONAL: the flue worker also carries
// operator keys (EXA_API_KEY / FIRECRAWL_API_KEY secrets) and a user key simply
// takes precedence when present. `/eve/health` reports which operator keys exist
// (lib/eve-health.ts) so Settings can say a backend already works without one.

// SecureStore keys allow only [A-Za-z0-9._-] — no `:` like the web's
// localStorage key names.
const PLAUSIBLE = /^[\w:.-]{10,200}$/;

export function isPlausibleSearchKey(v: string): boolean {
  return PLAUSIBLE.test(String(v || '').trim());
}

type KeyState = {
  key: string;
  hydrated: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
};

function createKeyStore(storageKey: string) {
  const useStore = create<KeyState>((set) => ({
    key: '',
    hydrated: false,
    setKey: (key) => {
      const next = String(key || '').trim();
      if (!PLAUSIBLE.test(next)) return;
      set({ key: next });
      SecureStore.setItemAsync(storageKey, next).catch(() => {});
    },
    clearKey: () => {
      set({ key: '' });
      SecureStore.deleteItemAsync(storageKey).catch(() => {});
    },
  }));

  const hydrate = () =>
    SecureStore.getItemAsync(storageKey)
      .then((v) => {
        useStore.setState({ key: v && PLAUSIBLE.test(v) ? v : '', hydrated: true });
      })
      .catch(() => {
        useStore.setState({ hydrated: true });
      });

  return { useStore, hydrate, get: () => useStore.getState().key };
}

const exa = createKeyStore('shot-studio.exaKey');
const firecrawl = createKeyStore('shot-studio.firecrawlKey');

export const useExaKeyStore = exa.useStore;
export const useFirecrawlKeyStore = firecrawl.useStore;

// Sync reads for the fetch shim.
export const getExaKey = exa.get;
export const getFirecrawlKey = firecrawl.get;

export function hydrateSearchKeys(): Promise<void> {
  return Promise.all([exa.hydrate(), firecrawl.hydrate()]).then(() => {});
}
