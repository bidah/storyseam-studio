import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// The user's Atlas Cloud API key (BYOK) — RN port of the web src/lib/atlasKey.js
// and the sibling of lib/fal-key.ts. Device-only: persisted in expo-secure-store,
// never sent to our D1/KV. It rides per-request instead — the fetch shim stamps
// it as `x-atlas-key` on Worker API calls and `x-flue-atlas-key` on `/eve/*`
// agent sends. The tabs guard accepts EITHER a fal key or an Atlas key;
// editable later on the Settings sheet (Providers section).

const STORAGE_KEY = 'shot-studio.atlasKey';

// Same conservative shape check as the fal key.
const PLAUSIBLE = /^[\w:.-]{10,200}$/;

export function isPlausibleAtlasKey(v: string): boolean {
  return PLAUSIBLE.test(v.trim());
}

type AtlasKeyState = {
  key: string;
  hydrated: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
};

export const useAtlasKeyStore = create<AtlasKeyState>((set) => ({
  key: '',
  hydrated: false,
  setKey: (key) => {
    const next = String(key || '').trim();
    if (!PLAUSIBLE.test(next)) return;
    set({ key: next });
    SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  },
  clearKey: () => {
    set({ key: '' });
    SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
  },
}));

// Sync read for the fetch shim (post-hydration; pre-hydration requests simply
// carry no key — the tabs gate blocks the UI until hydration anyway).
export function getAtlasKey(): string {
  return useAtlasKeyStore.getState().key;
}

export function hydrateAtlasKey(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useAtlasKeyStore.setState({ key: v && PLAUSIBLE.test(v) ? v : '', hydrated: true });
    })
    .catch(() => {
      useAtlasKeyStore.setState({ hydrated: true });
    });
}
