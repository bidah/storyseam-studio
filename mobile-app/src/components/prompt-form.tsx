import { ScrollView, Text, TextInput, View } from 'react-native';
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
      className="flex-1 bg-background"
      contentContainerClassName="grow gap-5 px-5 pt-5 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      {fields.map((f) => {
        const lines = f.lines ?? 1;
        return (
          <View key={f.key} className="gap-1.5">
            <Text className="text-[13px] font-medium text-foreground">{f.title}</Text>
            <TextInput
              defaultValue={f.initial}
              onChangeText={(v) => onChange(f.key, v)}
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              multiline={lines > 1}
              textAlignVertical={lines > 1 ? 'top' : 'center'}
              autoCapitalize="none"
              autoCorrect={false}
              style={lines > 1 ? { minHeight: 22 * lines } : undefined}
              className="rounded-xl border border-border bg-card px-3 py-2.5 text-[14px] leading-5 text-foreground"
            />
            {f.footer ? (
              <Text className="text-[12px] leading-4 text-muted-foreground">{f.footer}</Text>
            ) : null}
          </View>
        );
      })}
      {destructive ? (
        <Button variant="destructive" title={destructive.label} onPress={destructive.onPress} />
      ) : null}
    </ScrollView>
  );
}
