// The user's own fal.ai API key (BYOK) — the ONLY key any render runs on;
// StorySeam never lends its own.
//
// It lives in two places. Here, for the requests this browser makes: the
// projectFetch shim stamps it as `x-fal-key` on our own API calls and as
// `x-flue-fal-key` on `/eve/*` agent sends (the flue worker keeps it in the
// conversation's Durable Object so render tools can use it mid-run). And on the
// server, encrypted per user (`/api/account/fal-key`, worker/src/lib/user-fal-key.js),
// because a Film runs 20–40 minutes with no browser to carry it. Saving or
// clearing it here does both; `FalKeySync` uploads a key that predates the
// server copy, once per sign-in.
//
// Storage backend (lib/keyStore.js): localStorage in the browser; on the
// desktop app, the OS-keychain-encrypted safeStorage vault (with a one-time
// localStorage migration). Mandatory when fal is the selected provider (gate
// in components/Login.jsx); editable on the Settings page.
import { useEffect } from "react";
import { createKeyStore } from "@/lib/keyStore";
import { useSession } from "@/lib/auth-client";

const store = createKeyStore("shot-studio:falKey", "falKey");
const ENDPOINT = "/api/account/fal-key";

// Best-effort: signed out it 401s, and FalKeySync uploads it after sign-in.
function push(key) {
  const init = key
    ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) }
    : { method: "DELETE" };
  return fetch(ENDPOINT, init).catch(() => {});
}

export const getFalKey = store.get;
export const useFalKey = store.use;
// Desktop-only async hydration (awaited before first render); no-op on web.
export const initFalKey = store.init;

export function setFalKey(key) {
  store.set(key);
  push(String(key || "").trim());
}

export function clearFalKey() {
  store.clear();
  push("");
}

/**
 * Mounted once beside the router (src/main.jsx): when a signed-in user has a
 * key in this browser and none on the server, upload it — so a Film started
 * from anywhere (the agent's `make_film` included) can render on it.
 */
export function FalKeySync() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  useEffect(() => {
    const key = store.get();
    if (!userId || !key) return;
    fetch(ENDPOINT)
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => {
        if (status && !status.connected) push(key);
      })
      .catch(() => {});
  }, [userId]);
  return null;
}
