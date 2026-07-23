import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// Render-provider selection — RN port of the web src/lib/providers.js: exactly
// ONE of the three backends (Higgsfield / fal.ai / Atlas Cloud) is in use at a
// time (radio semantics; selecting one deselects the others). Credentials for
// all three can be stored side by side. The fetch shim translates the
// selection into per-request headers: `x-render-provider` (the selected
// backend — wins the catalog default) and `x-disabled-providers` (the two
// non-selected ids — their models leave the pickers). Stored BYOK keys ride
// regardless of selection so the worker can keep polling in-flight jobs from a
// previously selected provider. `/eve/*` sends carry the x-flue-* variants
// (persisted per conversation in the flue DO to steer the agent's default).

const STORAGE_KEY = 'shot-studio.providers';

export const PROVIDERS = [
  { id: 'higgsfield', label: 'Higgsfield', byok: false },
  { id: 'fal', label: 'fal.ai', byok: true },
  { id: 'atlas', label: 'Atlas Cloud', byok: true },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]['id'];
const IDS = PROVIDERS.map((p) => p.id);

// Higgsfield is the default selection (the sign-in itself is its credential).
// Tolerates the earlier `{ active, enabled }` stored shape — only `active`
// matters now.
function normalizeActive(raw: unknown): ProviderId {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return IDS.includes(o.active) ? o.active : 'higgsfield';
}

type ProvidersState = {
  active: ProviderId;
  hydrated: boolean;
  setActive: (id: ProviderId) => void;
};

export const useProvidersStore = create<ProvidersState>((set) => ({
  active: 'higgsfield',
  hydrated: false,
  setActive: (id) => {
    if (!IDS.includes(id)) return;
    set({ active: id });
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ active: id })).catch(() => {});
  },
}));

// Sync reads for the fetch shim.
export function getActiveProvider(): ProviderId {
  return useProvidersStore.getState().active;
}

// The two NON-selected ids for the disabled-providers header.
export function disabledProvidersCsv(): string {
  const active = getActiveProvider();
  return IDS.filter((id) => id !== active).join(',');
}

export function hydrateProviders(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useProvidersStore.setState({ active: normalizeActive(v ? JSON.parse(v) : null), hydrated: true });
    })
    .catch(() => {
      useProvidersStore.setState({ hydrated: true });
    });
}
