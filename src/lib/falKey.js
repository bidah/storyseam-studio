// The user's own fal.ai API key (BYOK). Client-side ONLY — never written to
// the server's D1/KV/R2. It reaches the backends per-request instead: the
// projectFetch shim stamps it as `x-fal-key` on our own API calls and as
// `x-flue-fal-key` on `/eve/*` agent sends (the flue worker keeps it in the
// conversation's Durable Object so render tools can use it mid-run; it is
// deleted with the conversation).
//
// Storage backend (lib/keyStore.js): localStorage in the browser; on the
// desktop app, the OS-keychain-encrypted safeStorage vault (with a one-time
// localStorage migration). Mandatory when fal is the selected provider (gate
// in components/Login.jsx); editable on the Settings page.
import { createKeyStore } from "@/lib/keyStore";

const store = createKeyStore("shot-studio:falKey", "falKey");

export const getFalKey = store.get;
export const setFalKey = store.set;
export const clearFalKey = store.clear;
export const useFalKey = store.use;
// Desktop-only async hydration (awaited before first render); no-op on web.
export const initFalKey = store.init;
