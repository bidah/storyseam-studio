import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
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

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

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
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.iconBadge}>
          <KeyRound size={22} color={colors.primaryForeground} />
        </View>
        <Text style={styles.title}>
          Connect your {provider.label} key
        </Text>
        <Text style={styles.subtitle}>
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
          style={styles.input}
          accessibilityLabel={`${provider.label} API key`}
          onSubmitEditing={save}
        />
        <Button
          title="Save & continue"
          size="lg"
          style={styles.saveButton}
          disabled={!plausible}
          onPress={save}
        />

        <Pressable
          style={styles.createKeyRow}
          onPress={() => Linking.openURL(provider.keysUrl)}
          accessibilityRole="link"
        >
          <Text style={styles.linkText}>Create a key on {provider.label}</Text>
          <ExternalLink size={12} color={colors.subtleForeground} />
        </Pressable>

        {/* This screen only shows when the selected BYOK provider has no key —
            offer the way back (Higgsfield's credential is the sign-in itself). */}
        <Pressable
          style={styles.switchRow}
          onPress={() => {
            setActiveProvider('higgsfield');
            router.replace('/chat');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>
            Or switch to Higgsfield and render with your sign-in
          </Text>
        </Pressable>

        <View style={styles.footerRow}>
          {session?.user?.email ? (
            <Text style={styles.footerText}>Signed in as {session.user.email}</Text>
          ) : null}
          <Pressable style={styles.signOutRow} onPress={signOut} accessibilityRole="button">
            <LogOut size={12} color={colors.subtleForeground} />
            <Text style={styles.linkText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconBadge: {
    height: 48,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
  },
  title: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    color: theme.colors.foreground,
  },
  subtitle: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  input: {
    marginTop: 16,
    width: '100%',
    fontFamily: MONO,
    fontSize: 13,
  },
  saveButton: {
    marginTop: 12,
    width: '100%',
  },
  createKeyRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
    textDecorationLine: 'underline',
  },
  switchRow: {
    marginTop: 12,
  },
  footerRow: {
    marginTop: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
}));
