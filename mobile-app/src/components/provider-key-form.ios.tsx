import { Host } from '@expo/ui';
import { Button, Form, SecureField, Section, Text } from '@expo/ui/swift-ui';

// Native SwiftUI key form (iOS) for the /provider-key sheet — Host > Form >
// Section > SecureField, the grouped-settings look. The route owns the draft
// state and the toolbar Save button; this tree only reports edits up and
// renders the destructive remove action when a key is already stored.
// iOS-only imports live here (.ios.tsx) — provider-key-form.tsx is the
// cross-platform fallback.
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
    <Host style={{ flex: 1 }}>
      <Form>
        <Section
          title="API key"
          footer={
            <Text>
              Stored only on this device (secure keychain) and sent per-request — never on
              our servers.
            </Text>
          }
        >
          <SecureField autoFocus placeholder={placeholder} onTextChange={onTextChange} />
        </Section>
        {hasKey ? (
          <Section title={`Stored key ${maskedKey}`}>
            <Button role="destructive" label="Remove key" onPress={onRemove} />
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}
