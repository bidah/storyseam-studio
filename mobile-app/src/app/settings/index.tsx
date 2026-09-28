import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner-native';
import SettingsForm from '@/components/settings-form';
import { modelsForProvider, useAgentModelStore, type AgentModelId } from '@/lib/agent-model';
import { apiJson } from '@/lib/api';
import { CHAT_PROVIDERS, useChatProviderStore, type ChatProviderId } from '@/lib/chat-provider';
import { authClient, useSession } from '@/lib/auth-client';
import { API_ORIGIN } from '@/lib/env';
import { useEveHealth } from '@/lib/eve-health';
import { useFalKeyStore } from '@/lib/fal-key';
import {
  connectHiggsfield,
  disconnectHiggsfield,
  LINKED_ACCOUNTS_KEY,
  useHiggsfieldLinked,
} from '@/lib/higgsfield-account';
import { useAtlasKeyStore } from '@/lib/atlas-key';
import { fromModelTag, toModelTag, type GenSettings } from '@/lib/gen-defaults';
import { PROVIDERS, providerEnabled, useProvidersStore, type ProviderId } from '@/lib/providers';
import { saveGenDefaults, SHEET_META, type PromptsDoc } from '@/lib/prompts';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useProjectStore } from '@/lib/project';
import { SANDBOXES, useSandboxStore, type SandboxModeId } from '@/lib/sandbox-mode';
import { useExaKeyStore, useFirecrawlKeyStore } from '@/lib/search-keys';
import { SEARCH_PROVIDERS, useSearchProviderStore, type SearchProviderId } from '@/lib/search-provider';
import { useThemeStore } from '@/lib/theme';

// Settings sheet — state + navigation only; the UI is SettingsForm (a native
// SwiftUI Form on iOS, RN fallback elsewhere). Everything that needs more room
// than a Form cell lives on a screen pushed WITHIN this sheet's nested stack
// (see settings/_layout): the BYOK keys (provider-key / search-key) and the
// prompt editors (style-prompts / style-prompt / sheet-prompt). For a keyless
// BYOK render provider, toggling it on pushes its key screen, and that screen's
// Save both stores the key and selects the provider — which is what finally
// flips the toggle here.
export default function SettingsSheet() {
  const { data: session } = useSession();
  const { model, setModel } = useAgentModelStore();
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);
  const invalidate = useInvalidate();
  const falKey = useFalKeyStore((s) => s.key);
  const atlasKey = useAtlasKeyStore((s) => s.key);
  const exaKey = useExaKeyStore((s) => s.key);
  const firecrawlKey = useFirecrawlKeyStore((s) => s.key);
  const { active, setActive } = useProvidersStore();
  const { active: sandbox, setActive: setSandbox } = useSandboxStore();
  const { active: chatProvider, setActive: setChatProvider } = useChatProviderStore();
  const { active: searchProvider, setActive: setSearchProvider } = useSearchProviderStore();
  const { pref: themePref, setPref: setThemePref } = useThemeStore();
  // Which key-gated backends the flue worker can actually reach — drives the
  // Cerebras row's availability and the search key screens' footnotes.
  const { data: health } = useEveHealth();

  // Native toggles flip optimistically; when a flip must NOT commit (keyless
  // on, or flipping the active one off — radio semantics), bumping the nonce
  // remounts them back to store state.
  const [switchNonce, setSwitchNonce] = useState(0);

  // Connectors: Higgsfield linked to the (Google) sign-in — the mobile twin of
  // the web's Settings › Connectors panel. Either action ends by refetching the
  // linked-account list, which is what flips the row's status.
  const hfLinked = useHiggsfieldLinked();
  const [connectorBusy, setConnectorBusy] = useState(false);
  const runConnector = async (fn: () => Promise<unknown>) => {
    setConnectorBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      await queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_KEY });
      setConnectorBusy(false);
    }
  };

  const keyFor = (id: ProviderId) => (id === 'fal' ? falKey : id === 'atlas' ? atlasKey : '');
  const searchKeyFor = (id: SearchProviderId) => (id === 'exa' ? exaKey : firecrawlKey);

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

  // Radio semantics, same as the render providers: switching one on switches
  // the other off, and flipping the active one OFF is not a valid state — the
  // nonce bump remounts that toggle back on.
  const toggleSandbox = (id: SandboxModeId, on: boolean) => {
    if (!on) {
      setSwitchNonce((n) => n + 1);
      return;
    }
    setSandbox(id);
  };

  // Same radio semantics: switching provider snaps the model catalog (agent-model
  // reconciles the selected model); flipping the active one OFF is not valid.
  const toggleChatProvider = (id: ChatProviderId, on: boolean) => {
    if (!on) {
      setSwitchNonce((n) => n + 1);
      return;
    }
    setChatProvider(id);
  };

  // Radio semantics again, but no key gate: the flue worker carries operator
  // keys, so a backend with no key of yours can still be selected.
  const toggleSearchProvider = (id: SearchProviderId, on: boolean) => {
    if (!on) {
      setSwitchNonce((n) => n + 1);
      return;
    }
    setSearchProvider(id);
  };

  // --- Project state: the visual-world doc's generation defaults + prompts ----
  const { data: vw } = useProjectResource<PromptsDoc>('visualWorld');
  // The live image-model catalog, same source as the World composer. It 401s
  // when no render provider is reachable — the picker then offers just the
  // server default, which is exactly what the web page falls back to.
  const { data: catalog } = useQuery<{ models?: { id: string; label: string }[] }>({
    queryKey: [projectId, 'imageModels'],
    queryFn: () => apiJson('/api/visual-world/models'),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // The pickers save on change (no Save button — the native settings idiom), so
  // the chosen value shows immediately and the doc refetch confirms it. A failed
  // write drops the override, snapping the picker back to the stored value.
  const [genOverride, setGenOverride] = useState<GenSettings | null>(null);
  const gen: GenSettings = genOverride ?? {
    model: vw?.settings?.model || '',
    aspectRatio: vw?.settings?.aspectRatio || '16:9',
  };
  const changeGen = async (patch: GenSettings) => {
    const next = { ...gen, ...patch };
    setGenOverride(next);
    try {
      await saveGenDefaults(next);
      invalidate('visualWorld');
    } catch (e: any) {
      toast.error(String(e?.message || e));
      setGenOverride(null);
    }
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
      themePref={themePref}
      onThemeChange={setThemePref}
      models={modelsForProvider(chatProvider)}
      modelId={model}
      onModelChange={(id) => setModel(id as AgentModelId)}
      chatProviders={CHAT_PROVIDERS.map((p) => {
        // Cloudflare Workers AI is keyless and always available; Cerebras and
        // OpenRouter are each gated on their own key, which /eve/health reports.
        const available =
          p.id === 'cloudflare' ||
          health?.providers?.[p.id as 'cerebras' | 'openrouter'] !== false;
        const models =
          p.id === 'cloudflare'
            ? 'Kimi, GPT-OSS, GLM, Claude'
            : p.id === 'openrouter'
              ? 'DeepSeek V4 Pro'
              : 'Gemma, GLM, GPT-OSS · ultra-fast';
        return {
          id: p.id,
          label: p.label,
          isOn: chatProvider === p.id,
          available,
          subtitle:
            p.id === 'cloudflare'
              ? `Default · ${models}`
              : available
                ? models
                : `${models} · needs a worker key`,
        };
      })}
      onToggleChatProvider={toggleChatProvider}
      providers={PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        byok: p.byok,
        hasKey: !!keyFor(p.id),
        isOn: active === p.id,
        subtitle:
          p.id === 'higgsfield'
            ? hfLinked === false
              ? 'Not connected — link it in Connectors'
              : hfLinked === true
                ? 'Connected through your linked account'
                : hfLinked === 'error'
                  ? 'Link status unknown'
                  : 'Checking linked account…'
            : keyFor(p.id)
              ? `Key ••••${keyFor(p.id).slice(-4)}`
              : 'No key added',
      }))}
      showConnectors={providerEnabled('higgsfield')}
      higgsfieldLinked={hfLinked}
      connectorBusy={connectorBusy}
      onConnectHiggsfield={() => void runConnector(connectHiggsfield)}
      onDisconnectHiggsfield={() => void runConnector(disconnectHiggsfield)}
      switchNonce={switchNonce}
      onToggleProvider={toggleProvider}
      onManageKey={(id) => router.push(`/settings/provider-key?provider=${id}`)}
      searchProviders={SEARCH_PROVIDERS.map((p) => {
        const key = searchKeyFor(p.id);
        return {
          id: p.id,
          label: p.label,
          isOn: searchProvider === p.id,
          hasKey: !!key,
          subtitle: key
            ? `${p.blurb} · key ••••${key.slice(-4)}`
            : health?.search?.[p.id]
              ? `${p.blurb} · built-in key`
              : `${p.blurb} · needs a key`,
        };
      })}
      onToggleSearchProvider={toggleSearchProvider}
      onManageSearchKey={(id) => router.push(`/settings/search-key?provider=${id}`)}
      sandboxes={SANDBOXES.map((s) => ({
        id: s.id,
        label: s.label,
        isOn: sandbox === s.id,
        subtitle:
          s.id === 'memory'
            ? 'Default — resets between messages'
            : 'Files last the whole conversation · billed',
      }))}
      onToggleSandbox={toggleSandbox}
      imageModels={(catalog?.models ?? []).filter((m) => m.id)}
      imageModelTag={toModelTag(gen.model)}
      onImageModelChange={(t) => void changeGen({ model: fromModelTag(t) })}
      aspectRatio={gen.aspectRatio || '16:9'}
      onAspectRatioChange={(a) => void changeGen({ aspectRatio: a })}
      promptLinks={[
        {
          key: 'style',
          label: 'Style presets',
          value: vw?.prompts ? String(vw.prompts.length) : undefined,
        },
        { key: 'character', label: SHEET_META.character.label },
        { key: 'location', label: SHEET_META.location.label },
        { key: 'prop', label: SHEET_META.prop.label },
      ]}
      onOpenPrompt={(key) =>
        router.push(key === 'style' ? '/settings/style-prompts' : `/settings/sheet-prompt?kind=${key}`)
      }
      apiOrigin={API_ORIGIN}
      onSignOut={signOut}
    />
  );
}
