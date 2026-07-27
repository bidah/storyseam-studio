import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import ProviderKeyForm from '@/components/provider-key-form';
import { useEveHealth } from '@/lib/eve-health';
import { isPlausibleSearchKey, useExaKeyStore, useFirecrawlKeyStore } from '@/lib/search-keys';
import { SEARCH_PROVIDERS, useSearchProviderStore } from '@/lib/search-provider';

// Web-search BYOK key screen, pushed WITHIN the settings sheet's nested stack
// (see settings/_layout) — one provider per push (?provider=exa|firecrawl).
// Mirrors settings/provider-key, with one difference that matters: these keys
// are OPTIONAL. The flue worker carries operator keys, so removing a key never
// strands the agent — it just falls back to the worker's — which is why this
// screen only ever pops back, never dismisses the sheet.
const CONFIG = {
  exa: SEARCH_PROVIDERS[0],
  firecrawl: SEARCH_PROVIDERS[1],
} as const;

export default function SearchKeySheet() {
  const params = useLocalSearchParams<{ provider?: string }>();
  const id = params.provider === 'firecrawl' ? 'firecrawl' : 'exa';
  const cfg = CONFIG[id];
  const exaStore = useExaKeyStore();
  const firecrawlStore = useFirecrawlKeyStore();
  const store = id === 'exa' ? exaStore : firecrawlStore;
  const setSearchProvider = useSearchProviderStore((s) => s.setActive);
  const { data: health } = useEveHealth();
  const [draft, setDraft] = useState('');
  const plausible = isPlausibleSearchKey(draft);

  // Saving also SELECTS the provider — the same "the key completes the toggle"
  // flow as the render providers.
  const save = () => {
    if (!plausible) return;
    store.setKey(draft);
    setSearchProvider(id);
    router.back();
  };

  const remove = () => {
    store.clearKey();
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: `${cfg.label} key` }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button disabled={!plausible} onPress={save}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ProviderKeyForm
        placeholder={cfg.placeholder}
        hasKey={!!store.key}
        maskedKey={store.key ? `••••${store.key.slice(-4)}` : ''}
        footnote={
          health?.search?.[id]
            ? `Optional — ${cfg.label} already works on the agent worker's own key. Yours takes precedence when set.`
            : `${cfg.label} has no key on the agent worker, so searches need yours.`
        }
        onTextChange={setDraft}
        onRemove={remove}
      />
    </>
  );
}
