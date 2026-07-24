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
import { useColors } from '@/lib/colors';

// Mandatory render-key step (RN port of the web ProviderKeyScreen in
// src/components/Login.jsx; route kept at /fal-key from the fal-only era).
// The screen is single-provider ON PURPOSE — no fal/Atlas tab bar. It only
// shows when the SELECTED BYOK provider has no key, so the provider it asks
// for is exactly the active selection (each provider gets its own dedicated
// screen). Saving stores the key in expo-secure-store (device-only) and
// returns to the tabs. Renders bill the USER'S account — keys never touch our
// servers.
const KEY_PROVIDERS = {
  fal: { id: 'fal', label: 'fal.ai', keysUrl: 'https://fal.ai/dashboard/keys', placeholder: 'key_id:key_secret' },
  atlas: { id: 'atlas', label: 'Atlas Cloud', keysUrl: 'https://www.atlascloud.ai/console/api-keys', placeholder: 'Atlas API key' },
} as const;

export default function ProviderKeyScreen() {
  const { data: session } = useSession();
  const setFalKey = useFalKeyStore((s) => s.setKey);
  const setAtlasKey = useAtlasKeyStore((s) => s.setKey);
  const active = useProvidersStore((s) => s.active);
  const setActiveProvider = useProvidersStore((s) => s.setActive);
  const queryClient = useQueryClient();
  const provider = active === 'atlas' ? KEY_PROVIDERS.atlas : KEY_PROVIDERS.fal;
  const [draft, setDraft] = useState('');
  const colors = useColors();
  const plausible = provider.id === 'fal' ? isPlausibleFalKey(draft) : isPlausibleAtlasKey(draft);

  const save = () => {
    if (!plausible) return;
    (provider.id === 'fal' ? setFalKey : setAtlasKey)(draft);
    // Re-assert the selection (covers a deep-link landing here with the fal
    // fallback) before unlocking the tabs.
    setActiveProvider(provider.id);
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
          <KeyRound size={22} color={colors.primaryForeground} />
        </View>
        <Text className="mt-6 text-center text-2xl font-semibold text-foreground">
          Connect your {provider.label} key
        </Text>
        <Text className="mt-2 text-center text-[14px] leading-5 text-muted-foreground">
          Shot Studio renders images and video with your own account — paste your{' '}
          {provider.label} API key to continue. It is stored only on this device (secure
          keychain), never on our servers, and you can switch providers later in
          Settings.
        </Text>

        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={provider.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoFocus
          className="mt-4 w-full font-mono text-[13px]"
          accessibilityLabel={`${provider.label} API key`}
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
          onPress={() => Linking.openURL(provider.keysUrl)}
          accessibilityRole="link"
        >
          <Text className="text-[12px] text-muted-foreground underline">Create a key on {provider.label}</Text>
          <ExternalLink size={12} color={colors.subtleForeground} />
        </Pressable>

        {/* This screen only shows when the selected BYOK provider has no key —
            offer the way back (Higgsfield's credential is the sign-in itself). */}
        <Pressable
          className="mt-3"
          onPress={() => {
            setActiveProvider('higgsfield');
            router.replace('/chat');
          }}
          accessibilityRole="button"
        >
          <Text className="text-[12px] text-muted-foreground underline">
            Or switch to Higgsfield and render with your sign-in
          </Text>
        </Pressable>

        <View className="mt-8 flex-row items-center gap-2">
          {session?.user?.email ? (
            <Text className="text-[12px] text-muted-foreground">Signed in as {session.user.email}</Text>
          ) : null}
          <Pressable className="flex-row items-center gap-1" onPress={signOut} accessibilityRole="button">
            <LogOut size={12} color={colors.subtleForeground} />
            <Text className="text-[12px] text-muted-foreground underline">Sign out</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
