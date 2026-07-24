import { useState } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import SettingsForm from '@/components/settings-form';
import { AGENT_MODELS, useAgentModelStore, type AgentModelId } from '@/lib/agent-model';
import { authClient, useSession } from '@/lib/auth-client';
import { API_ORIGIN } from '@/lib/env';
import { useFalKeyStore } from '@/lib/fal-key';
import { useAtlasKeyStore } from '@/lib/atlas-key';
import { PROVIDERS, useProvidersStore, type ProviderId } from '@/lib/providers';

// Settings sheet — state + navigation only; the UI is SettingsForm (a native
// SwiftUI Form on iOS, RN fallback elsewhere). Key entry/removal lives in the
// settings/provider-key screen, pushed WITHIN this sheet's nested stack (see
// settings/_layout): toggling on a keyless BYOK provider pushes it, and its
// Save both stores the key and selects the provider, which is what finally
// flips the toggle here.
export default function SettingsSheet() {
  const { data: session } = useSession();
  const { model, setModel } = useAgentModelStore();
  const queryClient = useQueryClient();
  const falKey = useFalKeyStore((s) => s.key);
  const atlasKey = useAtlasKeyStore((s) => s.key);
  const { active, setActive } = useProvidersStore();

  // Native toggles flip optimistically; when a flip must NOT commit (keyless
  // on, or flipping the active one off — radio semantics), bumping the nonce
  // remounts them back to store state.
  const [switchNonce, setSwitchNonce] = useState(0);

  const keyFor = (id: ProviderId) => (id === 'fal' ? falKey : id === 'atlas' ? atlasKey : '');

  const toggleProvider = (id: ProviderId, on: boolean) => {
    if (!on) {
      setSwitchNonce((n) => n + 1);
      return;
    }
    if (id !== 'higgsfield' && !keyFor(id)) {
      setSwitchNonce((n) => n + 1);
      router.push(`/settings/provider-key?provider=${id}`);
      return;
    }
    setActive(id);
  };

  const signOut = async () => {
    await authClient.signOut().catch(() => {});
    queryClient.clear();
    router.dismissAll();
    router.replace('/sign-in');
  };

  // Better-auth (OAuth) often seeds `name` with the email, which would render
  // the email twice in the Account row — fall back to a label so the email
  // only shows as the secondary line.
  const email = session?.user?.email || '';
  const rawName = session?.user?.name || '';
  const name = rawName && rawName !== email ? rawName : 'Signed in';

  return (
    <SettingsForm
      name={name}
      email={email}
      models={AGENT_MODELS}
      modelId={model}
      onModelChange={(id) => setModel(id as AgentModelId)}
      providers={PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        byok: p.byok,
        hasKey: !!keyFor(p.id),
        isOn: active === p.id,
        subtitle:
          p.id === 'higgsfield'
            ? 'Connected through your sign-in'
            : keyFor(p.id)
              ? `Key ••••${keyFor(p.id).slice(-4)}`
              : 'No key added',
      }))}
      switchNonce={switchNonce}
      onToggleProvider={toggleProvider}
      onManageKey={(id) => router.push(`/settings/provider-key?provider=${id}`)}
      apiOrigin={API_ORIGIN}
      onSignOut={signOut}
    />
  );
}
