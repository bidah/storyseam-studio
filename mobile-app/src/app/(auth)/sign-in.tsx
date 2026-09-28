import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { Clapperboard } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { authClient, confirmSignedIn } from '@/lib/auth-client';
import { useColors } from '@/lib/colors';
import { splashReady } from '@/lib/splash';

// Google is the only way in — the same Better Auth social provider as the web
// gate. There is no email/password form on the phone.
export default function SignIn() {
  const [oauthBusy, setOauthBusy] = useState(false);
  const colors = useColors();

  // "Sign in with Google" — the app login, same Better Auth social provider the
  // web gate uses (worker/src/auth.js). Higgsfield is no longer the front door:
  // it's a CONNECTOR linked afterwards in Settings › Connectors
  // (lib/higgsfield-account.ts), which is what unlocks rendering.
  const signInGoogle = async () => {
    setOauthBusy(true);
    try {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/create',
      });
      if (error) throw new Error(error.message || 'OAuth failed');
      // The Expo deep-link flow stores the session cookie *during* the call but
      // never navigates — without this the browser closes and we sit on the
      // sign-in screen. Confirm the
      // session actually landed first; a dismissed browser resolves without error
      // and leaves no session, so we shouldn't bounce into the app in that case.
      if (await confirmSignedIn()) {
        router.replace('/create');
      } else {
        toast.error('Google sign-in didn’t complete');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Google sign-in failed');
    } finally {
      setOauthBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The other cold-start landing: signed out, this is the finished screen,
      // so it lifts the splash itself (lib/splash.ts).
      onLayout={splashReady}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Clapperboard size={30} color={colors.primaryForeground} />
          </View>
          <Text style={styles.title}>StorySeam</Text>
          <Text style={styles.subtitle}>
            Create a film with just a prompt.
          </Text>
        </View>

        <Button title="Sign in with Google" loading={oauthBusy} onPress={signInGoogle} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { flex: 1, justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  header: { marginBottom: 16, alignItems: 'center', gap: 12 },
  iconWrap: {
    height: 64,
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    // The app icon / web favicon tile: square, solid brand colour.
    backgroundColor: theme.colors.primary,
  },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700', color: theme.colors.foreground },
  subtitle: { textAlign: 'center', fontSize: 14, lineHeight: 20, color: theme.colors.mutedForeground },
}));
