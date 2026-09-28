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

const ALL_PROVIDERS = [
  { id: 'higgsfield', label: 'Higgsfield', byok: false },
  { id: 'fal', label: 'Fal.ai', byok: true },
  { id: 'atlas', label: 'Atlas Cloud', byok: true },
] as const;
export type ProviderId = (typeof ALL_PROVIDERS)[number]['id'];
const ALL_IDS: ProviderId[] = ALL_PROVIDERS.map((p) => p.id);

// THE FLAG: which render providers this build offers — the mobile twin of the
// web's ENABLED_PROVIDERS (src/lib/providers.js). StorySeam ships fal-only, so
// the default is `fal`; set EXPO_PUBLIC_ENABLED_PROVIDERS=fal,higgsfield,atlas
// in .env to bring the others back. It is inlined at bundle time, so an OTA
// carries a change. A flagged-off provider loses every surface — the Settings
// rows, the Higgsfield connector, the Import segment, the key screen's
// "switch to Higgsfield" — while the code behind them stays untouched.
const FLAG = (process.env.EXPO_PUBLIC_ENABLED_PROVIDERS || 'fal')
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is ProviderId => (ALL_IDS as string[]).includes(s));
export const ENABLED_PROVIDERS: ProviderId[] = FLAG.length ? FLAG : ['fal'];
export const providerEnabled = (id: ProviderId) => ENABLED_PROVIDERS.includes(id);

export const PROVIDERS = ALL_PROVIDERS.filter((p) => providerEnabled(p.id));
const IDS: ProviderId[] = PROVIDERS.map((p) => p.id);
const DEFAULT_ACTIVE: ProviderId = IDS[0];

// The first enabled provider is the default selection; a stored selection the
// flag has since turned off (a phone that picked Higgsfield) falls back to it.
// Tolerates the earlier `{ active, enabled }` stored shape — only `active`
// matters now.
function normalizeActive(raw: unknown): ProviderId {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return IDS.includes(o.active) ? o.active : DEFAULT_ACTIVE;
}

type ProvidersState = {
  active: ProviderId;
  // "Skip for now" on the key screen (web: setSetupSkipped). A Film made from
  // the Create tab runs on StorySeam's own account, so the key is only needed
  // for studio renders — the author can start without one.
  skipped: boolean;
  hydrated: boolean;
  setActive: (id: ProviderId) => void;
  setSkipped: (v: boolean) => void;
};

const SKIP_KEY = 'shot-studio.setupSkipped';

export const useProvidersStore = create<ProvidersState>((set) => ({
  active: DEFAULT_ACTIVE,
  skipped: false,
  hydrated: false,
  setSkipped: (v) => {
    set({ skipped: v });
    (v ? SecureStore.setItemAsync(SKIP_KEY, '1') : SecureStore.deleteItemAsync(SKIP_KEY)).catch(() => {});
  },
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

// Every NON-selected id for the disabled-providers header — flagged-off
// providers included, so the worker and the agent never offer them either.
export function disabledProvidersCsv(): string {
  const active = getActiveProvider();
  return ALL_IDS.filter((id) => id !== active).join(',');
}

export function hydrateProviders(): Promise<void> {
  return Promise.all([SecureStore.getItemAsync(STORAGE_KEY), SecureStore.getItemAsync(SKIP_KEY)])
    .then(([v, skip]) => {
      useProvidersStore.setState({
        active: normalizeActive(v ? JSON.parse(v) : null),
        skipped: skip === '1',
        hydrated: true,
      });
    })
    .catch(() => {
      useProvidersStore.setState({ hydrated: true });
    });
}
