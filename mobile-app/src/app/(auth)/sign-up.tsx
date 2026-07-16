import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, confirmSignedIn } from '@/lib/auth-client';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await authClient.signUp.email({
        name: name.trim() || email.trim(),
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message || 'Sign-up failed');
      await confirmSignedIn();
      router.replace('/chat');
    } catch (e: any) {
      toast.error(e?.message || 'Sign-up failed');
    } finally {
      setBusy(false);
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
        <Text className="mb-2 text-3xl font-bold text-foreground">Create account</Text>
        <Input placeholder="Name" autoComplete="name" value={name} onChangeText={setName} />
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
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        <Button title="Sign up" loading={busy} onPress={submit} />
        <Button variant="ghost" title="Back to sign in" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
