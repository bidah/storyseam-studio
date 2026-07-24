import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Cross-platform fallback for the /provider-key sheet (the .ios.tsx sibling
// renders a native SwiftUI Form). Same props, plain RN controls.
export default function ProviderKeyForm({
  placeholder,
  hasKey,
  maskedKey,
  onTextChange,
  onRemove,
}: {
  placeholder: string;
  hasKey: boolean;
  maskedKey: string;
  onTextChange: (text: string) => void;
  onRemove: () => void;
}) {
  return (
    <View className="flex-1 gap-3 bg-background px-5 pt-4">
      <Input
        placeholder={placeholder}
        onChangeText={onTextChange}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        autoFocus
        className="font-mono text-[13px]"
        accessibilityLabel="API key"
      />
      <Text className="text-[12px] leading-4 text-muted-foreground">
        Stored only on this device (secure keychain) and sent per-request — never on our
        servers.
      </Text>
      {hasKey ? (
        <Button variant="destructive" title={`Remove key ${maskedKey}`} onPress={onRemove} />
      ) : null}
    </View>
  );
}
