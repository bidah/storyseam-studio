import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ExternalLink, KeyRound, LogOut } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, useSession } from '@/lib/auth-client';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';

// Mandatory fal.ai key step after sign-in (RN port of the web FalKeyScreen in
// src/components/Login.jsx). The tabs guard redirects here until a key exists;
// saving stores it in expo-secure-store (device-only) and returns to the tabs.
// Renders bill the USER'S fal account — the key never touches our servers.
export default function FalKeyScreen() {
  const { data: session } = useSession();
  const setKey = useFalKeyStore((s) => s.setKey);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const plausible = isPlausibleFalKey(draft);

  const save = () => {
    if (!plausible) return;
    setKey(draft);
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
          Connect your fal.ai key
        </Text>
        <Text className="mt-2 text-center text-[14px] leading-5 text-muted-foreground">
          Shot Studio renders images and video with your own fal.ai account. The key is
          stored only on this device (secure keychain), never on our servers, and you can
          change it later in Settings.
        </Text>

        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder="key_id:key_secret"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoFocus
          className="mt-7 w-full font-mono text-[13px]"
          accessibilityLabel="fal.ai API key"
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
          onPress={() => Linking.openURL('https://fal.ai/dashboard/keys')}
          accessibilityRole="link"
        >
          <Text className="text-[12px] text-muted-foreground underline">Create a key on fal.ai</Text>
          <ExternalLink size={12} color="#71717a" />
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
