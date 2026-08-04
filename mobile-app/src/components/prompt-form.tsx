import { ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@/components/ui/button';
import { useColors } from '@/lib/colors';
import type { PromptFormProps } from './prompt-form.types';

// Cross-platform fallback for the prompt editor screens (the .ios.tsx sibling
// renders a native SwiftUI Form). Same props, plain RN inputs — `defaultValue`
// is the uncontrolled seed, matching the iOS `useNativeState(initial)` capture.
export default function PromptForm({ fields, onChange, destructive }: PromptFormProps) {
  const colors = useColors();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {fields.map((f) => {
        const lines = f.lines ?? 1;
        return (
          <View key={f.key} style={styles.field}>
            <Text style={styles.label}>{f.title}</Text>
            <TextInput
              defaultValue={f.initial}
              onChangeText={(v) => onChange(f.key, v)}
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              multiline={lines > 1}
              textAlignVertical={lines > 1 ? 'top' : 'center'}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, lines > 1 && { minHeight: 22 * lines }]}
            />
            {f.footer ? <Text style={styles.footer}>{f.footer}</Text> : null}
          </View>
        );
      })}
      {destructive ? (
        <Button variant="destructive" title={destructive.label} onPress={destructive.onPress} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { flexGrow: 1, gap: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  footer: { fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
}));
