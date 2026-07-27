// Web-search provider selection: which backend the agent's `web_search` /
// `fetch_url` tools run on. Exactly ONE is loaded per conversation (unlike the
// render providers, where all backends' tools stay available so in-flight jobs
// can finish — a search call is synchronous, so there is nothing to strand).
//
// Client-side only (localStorage, like lib/providers.js and the BYOK keys). The
// projectFetch shim sends the selection on `/eve/*` prompt sends as
// `x-flue-search-provider`, alongside `x-flue-exa-key` / `x-flue-firecrawl-key`;
// the flue worker persists all three into the conversation's Durable Object
// (flue-agent/src/lib/search-prefs.ts) and resolves the turn's tools from them.
//
// Only the agent searches the web — no `/api/*` route consumes these, so unlike
// the render headers there is no non-`x-flue-` variant.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:searchProvider";

export const SEARCH_PROVIDERS = [
  {
    id: "exa",
    label: "Exa",
    keysUrl: "https://dashboard.exa.ai/api-keys",
    placeholder: "Exa API key",
    blurb: "Embeddings-based search — strongest at open-ended research and finding pages by description.",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    keysUrl: "https://www.firecrawl.dev/app/api-keys",
    placeholder: "fc-…",
    blurb: "Engine-style search with a heavy-duty extractor — strongest at reading JavaScript-rendered pages.",
  },
];
const IDS = SEARCH_PROVIDERS.map((p) => p.id);

export const DEFAULT_SEARCH_PROVIDER = "exa";

function normalize(raw) {
  return IDS.includes(raw) ? raw : DEFAULT_SEARCH_PROVIDER;
}

let current = (() => {
  try { return normalize(localStorage.getItem(STORAGE_KEY)); }
  catch { return DEFAULT_SEARCH_PROVIDER; }
})();
const listeners = new Set();

export function getSearchProvider() {
  return current;
}

export function setSearchProvider(id) {
  if (!IDS.includes(id) || id === current) return;
  current = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  for (const fn of listeners) { try { fn(id); } catch { /* ignore */ } }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for the Settings panel.
export function useSearchProvider() {
  return useSyncExternalStore(subscribe, getSearchProvider);
}
