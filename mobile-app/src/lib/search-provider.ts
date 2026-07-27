import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// Web-search provider selection — RN port of the web src/lib/searchProviders.js:
// which backend the agent's `web_search` / `fetch_url` tools run on. Exactly ONE
// is loaded per conversation (unlike the render providers, where all backends'
// tools stay available so in-flight jobs can finish — a search call is
// synchronous, so there is nothing to strand), which is why switching takes
// effect on the very next message.
//
// Device-only, like lib/providers.ts and the BYOK keys. The fetch shim sends the
// selection on `/eve/*` sends as `x-flue-search-provider`, alongside
// `x-flue-exa-key` / `x-flue-firecrawl-key`; the flue worker persists all three
// into the conversation's Durable Object (flue-agent/src/lib/search-prefs.ts)
// and resolves the turn's tools from them.
//
// Only the agent searches the web — no `/api/*` route consumes these, so unlike
// the render headers there is no non-`x-flue-` variant.

const STORAGE_KEY = 'shot-studio.searchProvider';

export const SEARCH_PROVIDERS = [
  {
    id: 'exa',
    label: 'Exa',
    placeholder: 'Exa API key',
    keysUrl: 'https://dashboard.exa.ai/api-keys',
    blurb: 'Embeddings-based research search',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    placeholder: 'fc-…',
    keysUrl: 'https://www.firecrawl.dev/app/api-keys',
    blurb: 'Engine search · heavy-duty extractor',
  },
] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number]['id'];
const IDS = SEARCH_PROVIDERS.map((p) => p.id);

export const DEFAULT_SEARCH_PROVIDER: SearchProviderId = 'exa';

function normalizeActive(raw: unknown): SearchProviderId {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return IDS.includes(o.active) ? o.active : DEFAULT_SEARCH_PROVIDER;
}

type SearchProviderState = {
  active: SearchProviderId;
  hydrated: boolean;
  setActive: (id: SearchProviderId) => void;
};

export const useSearchProviderStore = create<SearchProviderState>((set) => ({
  active: DEFAULT_SEARCH_PROVIDER,
  hydrated: false,
  setActive: (id) => {
    if (!IDS.includes(id)) return;
    set({ active: id });
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ active: id })).catch(() => {});
  },
}));

// Sync read for the fetch shim.
export function getSearchProvider(): SearchProviderId {
  return useSearchProviderStore.getState().active;
}

export function hydrateSearchProvider(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useSearchProviderStore.setState({
        active: normalizeActive(v ? JSON.parse(v) : null),
        hydrated: true,
      });
    })
    .catch(() => {
      useSearchProviderStore.setState({ hydrated: true });
    });
}
