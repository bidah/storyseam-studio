import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bot, KeyRound, LogOut, UserRound } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { authClient, useSession } from '@/lib/auth-client';
import { API_ORIGIN } from '@/lib/env';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';

export default function SettingsSheet() {
  const { data: session } = useSession();
  const model = useAgentModelStore((s) => s.model);
  const modelLabel = AGENT_MODELS.find((m) => m.id === model)?.label ?? model;
  const queryClient = useQueryClient();
  const { key: falKey, setKey: setFalKey, clearKey: clearFalKey } = useFalKeyStore();
  const [falDraft, setFalDraft] = useState('');
  const falPlausible = isPlausibleFalKey(falDraft);

  // Removing the key re-triggers the mandatory /fal-key gate (tabs layout), so
  // close this sheet first — the redirect happens underneath it.
  const removeFalKey = () => {
    clearFalKey();
    router.dismissAll();
  };

  const signOut = async () => {
    await authClient.signOut().catch(() => {});
    queryClient.clear();
    router.dismissAll();
    router.replace('/sign-in');
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

      <Eyebrow className="mt-2">fal.ai API key</Eyebrow>
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <KeyRound size={18} color="#10b981" />
          <Text className="flex-1 text-[13px] leading-4 text-muted-foreground">
            Renders bill your fal.ai account. Stored only on this device (secure keychain)
            {falKey ? ` — current key ••••${falKey.slice(-4)}` : ''}.
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Input
            value={falDraft}
            onChangeText={setFalDraft}
            placeholder={falKey ? 'Replace key' : 'key_id:key_secret'}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="flex-1 font-mono text-[12px]"
            accessibilityLabel="fal.ai API key"
          />
          <Button
            size="sm"
            variant="secondary"
            title={falKey ? 'Replace' : 'Save'}
            disabled={!falPlausible}
            onPress={() => {
              setFalKey(falDraft);
              setFalDraft('');
            }}
          />
        </View>
        {falKey ? (
          <Button size="sm" variant="destructive" title="Remove key" onPress={removeFalKey} />
        ) : null}
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
