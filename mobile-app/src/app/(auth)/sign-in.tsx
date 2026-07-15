import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Clapperboard } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);

  const signInEmail = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) throw new Error(error.message || 'Sign-in failed');
      router.replace('/chat');
    } catch (e: any) {
      toast.error(e?.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  // Same OAuth server the render skills use — one login yields both the app
  // account and the per-user Higgsfield token (see worker/src/auth.js).
  const signInHiggsfield = async () => {
    setOauthBusy(true);
    try {
      const { error } = await authClient.signIn.oauth2({
        providerId: 'higgsfield',
        callbackURL: '/chat',
      });
      if (error) throw new Error(error.message || 'OAuth failed');
      // The Expo deep-link flow stores the session cookie *during* the call but
      // never navigates — without this the browser closes and we sit on the
      // sign-in screen (parity with email sign-in's router.replace). Confirm the
      // session actually landed first; a dismissed browser resolves without error
      // and leaves no session, so we shouldn't bounce into the app in that case.
      const { data: session } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (session) {
        router.replace('/chat');
      } else {
        toast.error('Higgsfield sign-in didn’t complete');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Higgsfield sign-in failed');
    } finally {
      setOauthBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center gap-4 px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-primary/15">
            <Clapperboard size={30} color="#10b981" />
          </View>
          <Text className="text-3xl font-bold text-foreground">Shot Studio</Text>
          <Text className="text-center text-sm text-muted-foreground">
            Script → shots → renders → cuts, with an agent in the loop.
          </Text>
        </View>

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
        <Button title="Sign in" loading={busy} onPress={signInEmail} />
        <Button
          variant="outline"
          title="Sign in with Higgsfield"
          loading={oauthBusy}
          onPress={signInHiggsfield}
        />
        <Button
          variant="ghost"
          title="No account? Sign up"
          onPress={() => router.push('/sign-up')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
