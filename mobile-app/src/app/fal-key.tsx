import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { ExternalLink, KeyRound, Lock } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/lib/auth-client';
import { isPlausibleFalKey, useFalKeyStore } from '@/lib/fal-key';
import { isPlausibleAtlasKey, useAtlasKeyStore } from '@/lib/atlas-key';
import { providerEnabled, useProvidersStore } from '@/lib/providers';
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
  fal: { id: 'fal', label: 'Fal.ai', keysUrl: 'https://fal.ai/dashboard/keys', placeholder: 'Fal API key' },
  atlas: { id: 'atlas', label: 'Atlas Cloud', keysUrl: 'https://www.atlascloud.ai/console/api-keys', placeholder: 'Atlas API key' },
} as const;

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export default function ProviderKeyScreen() {
  const { data: session } = useSession();
  const setFalKey = useFalKeyStore((s) => s.setKey);
  const setAtlasKey = useAtlasKeyStore((s) => s.setKey);
  const active = useProvidersStore((s) => s.active);
  const setActiveProvider = useProvidersStore((s) => s.setActive);
  const setSkipped = useProvidersStore((s) => s.setSkipped);
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
    router.replace('/create');
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
          StorySeam needs your {provider.label} API key to render in the studio.
        </Text>
        <View style={styles.costs}>
          <Text style={styles.costLine}>
            <Text style={styles.costLabel}>On us: </Text>
            sandboxing, and the inference that writes and plans your story. Films made from
            Create run on StorySeam's own account.
          </Text>
          <Text style={styles.costLine}>
            <Text style={styles.costLabel}>On your credits: </Text>
            image, video, voice and soundtrack generations in the studio — they bill your{' '}
            {provider.label} account.
          </Text>
        </View>
        <View style={styles.storageRow}>
          <Lock size={12} color={colors.subtleForeground} />
          <Text style={styles.storageText}>
            Your key stays on this device, in the secure keychain. It rides along only with
            your own generation requests and is never stored on StorySeam's servers.
          </Text>
        </View>

        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={provider.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          spellCheck={false}
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
          style={({ pressed }) => [styles.secondaryButton, styles.createKeyButton, pressed && styles.pressed]}
          onPress={() => Linking.openURL(provider.keysUrl)}
          accessibilityRole="link"
          accessibilityLabel={`Create a key on ${provider.label}`}
        >
          <Text style={styles.secondaryText}>Create a key on {provider.label}</Text>
          <ExternalLink size={14} color={colors.foreground} />
        </Pressable>

        {/* This screen only shows when the selected BYOK provider has no key —
            offer the way back (Higgsfield's credential is the sign-in itself). */}
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => {
            setSkipped(true);
            router.replace('/create');
          }}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.secondaryText}>Skip for now — I'll add my key later</Text>
        </Pressable>

        {providerEnabled('higgsfield') ? (
        <Pressable
          style={styles.switchRow}
          onPress={() => {
            setActiveProvider('higgsfield');
            router.replace('/create');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>
            Or switch to Higgsfield and render with your sign-in
          </Text>
        </Pressable>
        ) : null}

        <View style={styles.footerRow}>
          {session?.user?.email ? (
            <Text style={styles.footerText}>Signed in as {session.user.email}</Text>
          ) : null}
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
    height: 52, // = the lg buttons below, so the column reads as one stack
    paddingVertical: 0,
    fontFamily: MONO,
    fontSize: 13,
  },
  saveButton: {
    marginTop: 12,
    width: '100%',
  },
  linkText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
    textDecorationLine: 'underline',
  },
  switchRow: {
    marginTop: 12,
  },
  // Secondary actions: bordered, on the card surface (white in light) — the
  // outline button's look without the iOS glass, which reads as a link here.
  secondaryButton: {
    marginTop: 10,
    width: '100%',
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  createKeyButton: { marginTop: 12 },
  secondaryText: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  pressed: { opacity: 0.6 },
  costs: {
    marginTop: 16,
    width: '100%',
    gap: 6,
    padding: 12,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  costLine: { fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  costLabel: { fontWeight: '600', color: theme.colors.foreground },
  storageRow: { marginTop: 10, flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  storageText: { flex: 1, fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
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
}));
