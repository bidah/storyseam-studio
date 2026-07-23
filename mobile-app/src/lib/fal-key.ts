import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// The user's fal.ai API key (BYOK) — RN port of the web src/lib/falKey.js.
// Device-only: persisted in expo-secure-store (Keychain / Keystore), never sent
// to our D1/KV. It rides per-request instead — the fetch shim stamps it as
// `x-fal-key` on Worker API calls and `x-flue-fal-key` on `/eve/*` agent sends
// (the flue worker keeps it in the conversation's Durable Object for its render
// tools). Mandatory after sign-in: the tabs guard redirects to /fal-key until a
// key exists; editable later on the Settings sheet (burger menu).

// SecureStore keys allow only [A-Za-z0-9._-] — no `:` like the web's
// localStorage key name.
const STORAGE_KEY = 'shot-studio.falKey';

// fal keys are `<uuid>:<hex>`-shaped; same conservative shape check as the web
// gate and the flue worker (isPlausibleFalKey in flue-agent/src/lib/fal-key.ts).
const PLAUSIBLE = /^[\w:.-]{10,200}$/;

export function isPlausibleFalKey(v: string): boolean {
  return PLAUSIBLE.test(v.trim());
}

type FalKeyState = {
  key: string;
  hydrated: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
};

export const useFalKeyStore = create<FalKeyState>((set) => ({
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
export function getFalKey(): string {
  return useFalKeyStore.getState().key;
}

export function hydrateFalKey(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useFalKeyStore.setState({ key: v && PLAUSIBLE.test(v) ? v : '', hydrated: true });
    })
    .catch(() => {
      useFalKeyStore.setState({ hydrated: true });
    });
}
