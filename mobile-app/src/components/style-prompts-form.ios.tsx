import { Host } from '@expo/ui';
import { Button, Form, HStack, Image, Section, Spacer, SwipeActions, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  disabled,
  foregroundStyle,
  lineLimit,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { useColors } from '@/lib/colors';
import { STYLE_PROMPTS_FOOTNOTE, type StylePromptsFormProps } from './style-prompts-form.types';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' } as const);
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' } as const);

// Native SwiftUI list of the project's style presets (iOS). Each row is a
// disclosure Button (navigation is expo-router's job — it pushes the editor
// within the settings stack) wrapped in SwipeActions for the native
// swipe-to-delete. iOS-only imports live here (.ios.tsx); style-prompts-form.tsx
// is the cross-platform fallback.
export default function StylePromptsForm({
  presets,
  onOpen,
  onDelete,
  onAdd,
  busy = false,
}: StylePromptsFormProps) {
  const colors = useColors();
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(colors.groupedBg)]}>
        <Section title="Style presets" footer={<Text>{STYLE_PROMPTS_FOOTNOTE}</Text>}>
          {presets.map((p) => (
            <SwipeActions key={p.id}>
              <Button onPress={() => onOpen(p.id)} modifiers={[buttonStyle('plain')]}>
                <HStack spacing={6}>
                  <VStack alignment="leading" spacing={2}>
                    <Text modifiers={[lineLimit(1)]}>
                      {p.builtin ? `${p.name} · seed` : p.name}
                    </Text>
                    {/* One line only — a house-style block is paragraphs long. */}
                    <Text modifiers={[SECONDARY, lineLimit(1)]}>
                      {p.preview || 'No image style yet'}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image systemName="chevron.right" size={12} modifiers={[TERTIARY]} />
                </HStack>
              </Button>
              <SwipeActions.Actions edge="trailing">
                <Button
                  role="destructive"
                  label="Delete"
                  systemImage="trash"
                  onPress={() => onDelete(p.id)}
                  modifiers={[disabled(busy)]}
                />
              </SwipeActions.Actions>
            </SwipeActions>
          ))}
          {presets.length === 0 ? <Text modifiers={[SECONDARY]}>No presets yet</Text> : null}
        </Section>

        <Section>
          <Button label="Add preset" systemImage="plus" onPress={onAdd} modifiers={[disabled(busy)]} />
        </Section>
      </Form>
    </Host>
  );
}
