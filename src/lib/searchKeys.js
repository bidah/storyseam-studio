// The user's own web-search API keys (BYOK) — Exa and Firecrawl. Same model as
// the render keys (lib/falKey.js / lib/atlasKey.js): client-side ONLY, never
// written to our D1/KV/R2. They reach the agent per-request — the projectFetch
// shim stamps them on `/eve/*` sends as `x-flue-exa-key` / `x-flue-firecrawl-key`
// and the flue worker keeps them in the conversation's Durable Object so the
// web_search / fetch_url tools can use them mid-run.
//
// Unlike the render keys these are OPTIONAL: the flue worker also carries
// operator keys (EXA_API_KEY / FIRECRAWL_API_KEY secrets), and a user key simply
// takes precedence when present. `/eve/health` reports which operator keys exist
// so Settings can say so.
//
// Storage backend (lib/keyStore.js): localStorage in the browser; on the desktop
// app, the OS-keychain-encrypted safeStorage vault. Editable on the Settings
// page (Web search panel).
import { createKeyStore } from "@/lib/keyStore";

const exa = createKeyStore("shot-studio:exaKey", "exaKey");
const firecrawl = createKeyStore("shot-studio:firecrawlKey", "firecrawlKey");

export const getExaKey = exa.get;
export const setExaKey = exa.set;
export const clearExaKey = exa.clear;
export const useExaKey = exa.use;

export const getFirecrawlKey = firecrawl.get;
export const setFirecrawlKey = firecrawl.set;
export const clearFirecrawlKey = firecrawl.clear;
export const useFirecrawlKey = firecrawl.use;

// Desktop-only async hydration (awaited before first render); no-op on web.
export const initSearchKeys = async () => {
  await Promise.all([exa.init(), firecrawl.init()]);
};
