import { Host } from '@expo/ui';
import { Button, Form, SecureField, Section, Text } from '@expo/ui/swift-ui';
import { background, scrollContentBackground } from '@expo/ui/swift-ui/modifiers';
import { useColors } from '@/lib/colors';

// Native SwiftUI key form (iOS) for the settings/provider-key screen — Host >
// Form > Section > SecureField, the grouped-settings look. Pushed WITHIN the
// Settings sheet's nested stack (not its own sheet), so the field can safely
// autoFocus: the user leaves with the Back button, not a swipe-down that a
// focused field would otherwise eat (the two-swipe formSheet trap). The route
// owns the draft state and the toolbar Save button; this tree only reports
// edits up and renders the destructive remove action when a key is stored.
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
  // SwiftUI Forms default to systemGroupedBackground; hide it and paint the
  // scheme's page background behind the grouped cells to match every screen.
  const colors = useColors();
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(colors.pageBg)]}>
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
