import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
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
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create account</Text>
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

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { flex: 1, justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  title: { marginBottom: 8, fontSize: 30, lineHeight: 36, fontWeight: '700', color: theme.colors.foreground },
}));
