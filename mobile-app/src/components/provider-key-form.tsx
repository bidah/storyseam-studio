import { Platform, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

// Cross-platform fallback for the /provider-key sheet (the .ios.tsx sibling
// renders a native SwiftUI Form). Same props, plain RN controls.
export default function ProviderKeyForm({
  placeholder,
  hasKey,
  maskedKey,
  footnote,
  onTextChange,
  onRemove,
}: {
  placeholder: string;
  hasKey: boolean;
  maskedKey: string;
  footnote?: string;
  onTextChange: (text: string) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.root}>
      <Input
        placeholder={placeholder}
        onChangeText={onTextChange}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        autoFocus
        style={styles.input}
        accessibilityLabel="API key"
      />
      <Text style={styles.footnote}>
        Stored only on this device (secure keychain) and sent per-request — never on our
        servers.{footnote ? ` ${footnote}` : ''}
      </Text>
      {hasKey ? (
        <Button variant="destructive" title={`Remove key ${maskedKey}`} onPress={onRemove} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, gap: 12, backgroundColor: theme.colors.background, paddingHorizontal: 20, paddingTop: 16 },
  input: { fontFamily: MONO, fontSize: 13 },
  footnote: { fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
}));
