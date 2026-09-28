import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import ProviderKeyForm from '@/components/provider-key-form';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';
import { isPlausibleAtlasKey, useAtlasKeyStore } from '@/lib/atlas-key';
import { useProvidersStore } from '@/lib/providers';

// BYOK key screen, pushed WITHIN the settings sheet's nested stack (see
// settings/_layout) — one provider per push (?provider=fal|atlas), just the key
// field + a toolbar Save, left via the Back button. Saving also SELECTS the
// provider — this is what completes the settings toggle the user flipped to get
// here. router.back() pops to the settings form; router.dismissAll() (remove of
// the in-use key) closes the whole sheet so the /fal-key tabs gate takes over.
const CONFIG = {
  fal: { label: 'Fal.ai', placeholder: 'Fal API key', plausible: isPlausibleFalKey },
  atlas: { label: 'Atlas Cloud', placeholder: 'Atlas API key', plausible: isPlausibleAtlasKey },
} as const;

export default function ProviderKeySheet() {
  const params = useLocalSearchParams<{ provider?: string }>();
  const id = params.provider === 'atlas' ? 'atlas' : 'fal';
  const cfg = CONFIG[id];
  const falStore = useFalKeyStore();
  const atlasStore = useAtlasKeyStore();
  const store = id === 'fal' ? falStore : atlasStore;
  const { active, setActive } = useProvidersStore();
  const [draft, setDraft] = useState('');
  const plausible = cfg.plausible(draft);

  const save = () => {
    if (!plausible) return;
    store.setKey(draft);
    setActive(id);
    router.back();
  };

  const remove = () => {
    store.clearKey();
    if (active === id) {
      // Cleared the in-use provider's key — close everything so the tabs
      // layout gate (/fal-key) can take over.
      router.dismissAll();
    } else {
      router.back();
    }
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
        onTextChange={setDraft}
        onRemove={remove}
      />
    </>
  );
}
