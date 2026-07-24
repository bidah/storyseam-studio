// The user's own Atlas Cloud API key (BYOK) — the exact same model as the fal
// key (src/lib/falKey.js): client-side only, rides per-request via the
// projectFetch shim (`x-atlas-key` on our own API calls, `x-flue-atlas-key` on
// `/eve/*` agent sends — the flue worker keeps it in the conversation's Durable
// Object so render tools can use it mid-run).
//
// Storage backend (lib/keyStore.js): localStorage in the browser; on the
// desktop app, the OS-keychain-encrypted safeStorage vault (with a one-time
// localStorage migration). Editable on the Settings page (Providers panel);
// the post-login key gate in components/Login.jsx accepts either provider key.
import { createKeyStore } from "@/lib/keyStore";

const store = createKeyStore("shot-studio:atlasKey", "atlasKey");

export const getAtlasKey = store.get;
export const setAtlasKey = store.set;
export const clearAtlasKey = store.clear;
export const useAtlasKey = store.use;
// Desktop-only async hydration (awaited before first render); no-op on web.
export const initAtlasKey = store.init;
