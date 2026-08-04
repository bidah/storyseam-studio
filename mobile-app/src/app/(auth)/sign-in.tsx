import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Clapperboard } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, confirmSignedIn } from '@/lib/auth-client';
import { useColors } from '@/lib/colors';
import { splashReady } from '@/lib/splash';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const colors = useColors();

  const signInEmail = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) throw new Error(error.message || 'Sign-in failed');
      await confirmSignedIn();
      router.replace('/chat');
    } catch (e: any) {
      toast.error(e?.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  // "Sign in with Google" — the app login, same Better Auth social provider the
  // web gate uses (worker/src/auth.js). Higgsfield is no longer the front door:
  // it's a CONNECTOR linked afterwards in Settings › Connectors
  // (lib/higgsfield-account.ts), which is what unlocks rendering.
  const signInGoogle = async () => {
    setOauthBusy(true);
    try {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/chat',
      });
      if (error) throw new Error(error.message || 'OAuth failed');
      // The Expo deep-link flow stores the session cookie *during* the call but
      // never navigates — without this the browser closes and we sit on the
      // sign-in screen (parity with email sign-in's router.replace). Confirm the
      // session actually landed first; a dismissed browser resolves without error
      // and leaves no session, so we shouldn't bounce into the app in that case.
      if (await confirmSignedIn()) {
        router.replace('/chat');
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
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The other cold-start landing: signed out, this is the finished screen,
      // so it lifts the splash itself (lib/splash.ts).
      onLayout={splashReady}
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center gap-4 px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-primary/15">
            <Clapperboard size={30} color={colors.primary} />
          </View>
          <Text className="text-3xl font-bold text-foreground">Shot Studio</Text>
          <Text className="text-center text-sm text-muted-foreground">
            Script → shots → renders → cuts, with an agent in the loop.
          </Text>
        </View>

        <Button title="Sign in with Google" loading={oauthBusy} onPress={signInGoogle} />
        <Text className="text-center text-xs text-muted-foreground">or use email</Text>

        <Input
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Input
          placeholder="Password"
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={signInEmail}
        />
        <Button variant="outline" title="Sign in" loading={busy} onPress={signInEmail} />
        <Button
          variant="ghost"
          title="No account? Sign up"
          onPress={() => router.push('/sign-up')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
