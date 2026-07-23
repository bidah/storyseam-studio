import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ExternalLink, KeyRound, LogOut } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, useSession } from '@/lib/auth-client';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';
import { isPlausibleAtlasKey, useAtlasKeyStore } from '@/lib/atlas-key';
import { useProvidersStore } from '@/lib/providers';

// Mandatory render-key step after sign-in (RN port of the web ProviderKeyScreen
// in src/components/Login.jsx; route kept at /fal-key from the fal-only era).
// One key from EITHER BYOK provider (fal.ai or Atlas Cloud) unlocks the tabs;
// saving stores it in expo-secure-store (device-only) and returns to the tabs.
// Renders bill the USER'S account — keys never touch our servers.
const KEY_PROVIDERS = [
  { id: 'fal', label: 'fal.ai', keysUrl: 'https://fal.ai/dashboard/keys', placeholder: 'key_id:key_secret' },
  { id: 'atlas', label: 'Atlas Cloud', keysUrl: 'https://www.atlascloud.ai/console/api-keys', placeholder: 'Atlas API key' },
] as const;

export default function ProviderKeyScreen() {
  const { data: session } = useSession();
  const setFalKey = useFalKeyStore((s) => s.setKey);
  const setAtlasKey = useAtlasKeyStore((s) => s.setKey);
  const setActiveProvider = useProvidersStore((s) => s.setActive);
  const queryClient = useQueryClient();
  const [pick, setPick] = useState<(typeof KEY_PROVIDERS)[number]>(KEY_PROVIDERS[0]);
  const [draft, setDraft] = useState('');
  const plausible = pick.id === 'fal' ? isPlausibleFalKey(draft) : isPlausibleAtlasKey(draft);

  const save = () => {
    if (!plausible) return;
    (pick.id === 'fal' ? setFalKey : setAtlasKey)(draft);
    router.replace('/chat');
  };

  const signOut = async () => {
    await authClient.signOut().catch(() => {});
    queryClient.clear();
    router.replace('/sign-in');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 items-center justify-center px-6">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary">
          <KeyRound size={22} color="#0a0a0b" />
        </View>
        <Text className="mt-6 text-center text-2xl font-semibold text-foreground">
          Connect a render key
        </Text>
        <Text className="mt-2 text-center text-[14px] leading-5 text-muted-foreground">
          Shot Studio renders images and video with your own account — paste a fal.ai or
          Atlas Cloud API key to continue. It is stored only on this device (secure
          keychain), never on our servers, and you can add the other provider later in
          Settings.
        </Text>

        <View className="mt-6 flex-row gap-1 rounded-xl border border-border bg-card p-1">
          {KEY_PROVIDERS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={pick.id === p.id ? 'secondary' : 'ghost'}
              title={p.label}
              onPress={() => {
                setPick(p);
                setDraft('');
              }}
            />
          ))}
        </View>

        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={pick.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoFocus
          className="mt-4 w-full font-mono text-[13px]"
          accessibilityLabel={`${pick.label} API key`}
          onSubmitEditing={save}
        />
        <Button
          title="Save & continue"
          size="lg"
          className="mt-3 w-full"
          disabled={!plausible}
          onPress={save}
        />

        <Pressable
          className="mt-4 flex-row items-center gap-1.5"
          onPress={() => Linking.openURL(pick.keysUrl)}
          accessibilityRole="link"
        >
          <Text className="text-[12px] text-muted-foreground underline">Create a key on {pick.label}</Text>
          <ExternalLink size={12} color="#71717a" />
        </Pressable>

        {/* This screen only shows when Higgsfield was toggled off — offer the
            way back (re-enabling it makes the sign-in the render credential). */}
        <Pressable
          className="mt-3"
          onPress={() => {
            setActiveProvider('higgsfield');
            router.replace('/chat');
          }}
          accessibilityRole="button"
        >
          <Text className="text-[12px] text-muted-foreground underline">
            Or re-enable Higgsfield and render with your sign-in
          </Text>
        </Pressable>

        <View className="mt-8 flex-row items-center gap-2">
          {session?.user?.email ? (
            <Text className="text-[12px] text-muted-foreground">Signed in as {session.user.email}</Text>
          ) : null}
          <Pressable className="flex-row items-center gap-1" onPress={signOut} accessibilityRole="button">
            <LogOut size={12} color="#71717a" />
            <Text className="text-[12px] text-muted-foreground underline">Sign out</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
