import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Host, Switch } from '@expo/ui';
import { Bot, KeyRound, LogOut, UserRound } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { authClient, useSession } from '@/lib/auth-client';
import { API_ORIGIN } from '@/lib/env';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';
import { isPlausibleAtlasKey, useAtlasKeyStore } from '@/lib/atlas-key';
import { PROVIDERS, useProvidersStore, type ProviderId } from '@/lib/providers';

// One BYOK key editor (fal.ai / Atlas Cloud) inside a provider card. Keys live
// in expo-secure-store only and ride per-request — never on our servers.
function KeyEditor({
  label,
  keyValue,
  plausible,
  onSave,
  onRemove,
  placeholder,
}: {
  label: string;
  keyValue: string;
  plausible: (v: string) => boolean;
  onSave: (v: string) => void;
  onRemove: () => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={keyValue ? `Replace key ••••${keyValue.slice(-4)}` : placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          className="flex-1 font-mono text-[12px]"
          accessibilityLabel={`${label} API key`}
        />
        <Button
          size="sm"
          variant="secondary"
          title={keyValue ? 'Replace' : 'Save'}
          disabled={!plausible(draft)}
          onPress={() => {
            onSave(draft);
            setDraft('');
          }}
        />
      </View>
      {keyValue ? <Button size="sm" variant="destructive" title="Remove key" onPress={onRemove} /> : null}
    </View>
  );
}

export default function SettingsSheet() {
  const { data: session } = useSession();
  const model = useAgentModelStore((s) => s.model);
  const modelLabel = AGENT_MODELS.find((m) => m.id === model)?.label ?? model;
  const queryClient = useQueryClient();
  const { key: falKey, setKey: setFalKey, clearKey: clearFalKey } = useFalKeyStore();
  const { key: atlasKey, setKey: setAtlasKey, clearKey: clearAtlasKey } = useAtlasKeyStore();
  const { active, enabled, setActive, setEnabled } = useProvidersStore();

  // Removing the last render credential (no other key AND Higgsfield toggled
  // off) re-triggers the /fal-key gate (tabs layout), so close this sheet
  // first — the redirect happens underneath it.
  const removeKey = (clear: () => void, otherKey: string) => {
    clear();
    if (!otherKey && !enabled.higgsfield) router.dismissAll();
  };

  const signOut = async () => {
    await authClient.signOut().catch(() => {});
    queryClient.clear();
    router.dismissAll();
    router.replace('/sign-in');
  };

  // Per-provider card body: Higgsfield is credentialed by the sign-in itself;
  // fal / Atlas get a key editor.
  const rows: Record<ProviderId, { hasCred: boolean; body: ReactNode }> = {
    higgsfield: {
      hasCred: true,
      body: (
        <Text className="text-[12px] leading-4 text-muted-foreground">
          Connected through your Higgsfield sign-in — no key needed.
        </Text>
      ),
    },
    fal: {
      hasCred: !!falKey,
      body: (
        <KeyEditor
          label="fal.ai"
          keyValue={falKey}
          plausible={isPlausibleFalKey}
          onSave={setFalKey}
          onRemove={() => removeKey(clearFalKey, atlasKey)}
          placeholder="key_id:key_secret"
        />
      ),
    },
    atlas: {
      hasCred: !!atlasKey,
      body: (
        <KeyEditor
          label="Atlas Cloud"
          keyValue={atlasKey}
          plausible={isPlausibleAtlasKey}
          onSave={setAtlasKey}
          onRemove={() => removeKey(clearAtlasKey, falKey)}
          placeholder="Atlas API key"
        />
      ),
    },
  };

  return (
    <View className="flex-1 gap-4 bg-background px-5 pt-6">
      <Eyebrow>Account</Eyebrow>
      <Card className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <UserRound size={18} color="#a1a1aa" />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {session?.user?.name || 'Signed in'}
          </Text>
          <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
            {session?.user?.email}
          </Text>
        </View>
      </Card>

      <Eyebrow className="mt-2">Agent</Eyebrow>
      <Card className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Bot size={18} color="#10b981" />
          <Text className="text-[15px] text-foreground">Chat model</Text>
        </View>
        <Button
          size="sm"
          variant="secondary"
          title={modelLabel}
          onPress={() => {
            router.back();
            router.push('/model-picker');
          }}
        />
      </Card>

      <Eyebrow className="mt-2">Render providers</Eyebrow>
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <KeyRound size={18} color="#10b981" />
          <Text className="flex-1 text-[12px] leading-4 text-muted-foreground">
            Renders bill your accounts. Keys are stored only on this device (secure
            keychain) and sent per-request — never on our servers. Toggle providers off
            to hide their models; the active one is the default backend.
          </Text>
        </View>
        {PROVIDERS.map((p) => {
          const row = rows[p.id];
          const isOn = enabled[p.id];
          return (
            <View key={p.id} className={`gap-2 rounded-xl border border-border p-3 ${isOn ? '' : 'opacity-60'}`}>
              <View className="flex-row items-center gap-2">
                <Text className="text-[14px] font-medium text-foreground">{p.label}</Text>
                {active === p.id ? (
                  <View className="rounded-full bg-primary/15 px-2 py-0.5">
                    <Text className="text-[11px] font-medium text-primary">Active</Text>
                  </View>
                ) : isOn && row.hasCred ? (
                  <Button size="sm" variant="ghost" title="Make active" onPress={() => setActive(p.id)} />
                ) : null}
                <View className="ml-auto">
                  <Host matchContents>
                    <Switch value={isOn} onValueChange={(on) => setEnabled(p.id, on)} />
                  </Host>
                </View>
              </View>
              {row.body}
            </View>
          );
        })}
      </Card>

      <View className="mt-auto gap-3 pb-10">
        <Text className="text-center text-xs text-muted-foreground">{API_ORIGIN}</Text>
        <Button variant="destructive" title="Sign out" onPress={signOut}>
          <LogOut size={16} color="#fafafa" />
        </Button>
      </View>
    </View>
  );
}
