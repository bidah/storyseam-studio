import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// Render-provider preferences — RN port of the web src/lib/providers.js: which
// of the three backends (Higgsfield / fal.ai / Atlas Cloud) are ENABLED, and
// which one is ACTIVE (the default backend whose default model wins when none
// is picked). The fetch shim translates the prefs into per-request headers:
// a disabled provider's key is not sent and its id rides in
// `x-disabled-providers` (also suppressing server env fallbacks / the
// Higgsfield token); the active provider rides as `x-render-provider`. `/eve/*`
// sends carry the x-flue-* variants (persisted per conversation in the flue DO;
// the disabled CSV is sent even when empty so re-enabling overwrites it).

const STORAGE_KEY = 'shot-studio.providers';

export const PROVIDERS = [
  { id: 'higgsfield', label: 'Higgsfield', byok: false },
  { id: 'fal', label: 'fal.ai', byok: true },
  { id: 'atlas', label: 'Atlas Cloud', byok: true },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]['id'];
const IDS = PROVIDERS.map((p) => p.id);

type Prefs = { active: ProviderId; enabled: Record<ProviderId, boolean> };

// Higgsfield stays the default active provider — matches the web default.
function normalize(raw: unknown): Prefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const en = o.enabled && typeof o.enabled === 'object' ? o.enabled : {};
  const enabled = Object.fromEntries(IDS.map((id) => [id, en[id] !== false])) as Record<ProviderId, boolean>;
  let active: ProviderId = IDS.includes(o.active) ? o.active : 'higgsfield';
  if (!enabled[active]) active = IDS.find((id) => enabled[id]) || 'higgsfield';
  return { active, enabled };
}

type ProvidersState = Prefs & {
  hydrated: boolean;
  setActive: (id: ProviderId) => void;
  setEnabled: (id: ProviderId, on: boolean) => void;
};

function persist(prefs: Prefs) {
  SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  ...normalize(null),
  hydrated: false,
  // Making a provider active also enables it.
  setActive: (id) => {
    const next = normalize({ active: id, enabled: { ...get().enabled, [id]: true } });
    set(next);
    persist(next);
  },
  // Disabling the active provider hands "active" to the first remaining
  // enabled one; disabling the LAST enabled provider is a no-op.
  setEnabled: (id, on) => {
    const enabled = { ...get().enabled, [id]: !!on };
    if (!IDS.some((x) => enabled[x])) return;
    const next = normalize({ active: get().active, enabled });
    set(next);
    persist(next);
  },
}));

// Sync reads for the fetch shim.
export function getProviderPrefs(): Prefs {
  const { active, enabled } = useProvidersStore.getState();
  return { active, enabled };
}

export function disabledProvidersCsv(): string {
  const { enabled } = useProvidersStore.getState();
  return IDS.filter((id) => !enabled[id]).join(',');
}

export function hydrateProviders(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      const prefs = normalize(v ? JSON.parse(v) : null);
      useProvidersStore.setState({ ...prefs, hydrated: true });
    })
    .catch(() => {
      useProvidersStore.setState({ hydrated: true });
    });
}
