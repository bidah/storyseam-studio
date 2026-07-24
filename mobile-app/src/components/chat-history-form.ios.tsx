import { Host } from '@expo/ui';
import {
  Button,
  ContentUnavailableView,
  Form,
  HStack,
  Image,
  Section,
  Spacer,
  SwipeActions,
  Text,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  foregroundStyle,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import type { ChatHistoryFormProps } from './chat-history-form.types';

// The app's near-black page background (parity with settings + the RN nav
// theme). SwiftUI Forms default to systemGroupedBackground (dark gray), so we
// hide that and paint this behind the grouped cells.
const PAGE_BG = '#0a0a0b';

// Native SwiftUI chat history (iOS): one grouped Form whose Section holds the
// conversation rows — the same shape as the settings sheet. Each row is a
// plain-styled Button (so the title keeps the default label color instead of
// the accent tint) with a native trailing swipe-to-delete. iOS-only imports
// live here (.ios.tsx); chat-history-form.tsx is the fallback.
export default function ChatHistoryForm({ chats, onSelect, onDelete }: ChatHistoryFormProps) {
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(PAGE_BG)]}>
        {chats.length === 0 ? (
          <Section>
            <ContentUnavailableView
              title="No chats yet"
              systemImage="bubble.left.and.text.bubble.right"
              description="Start a conversation with the studio agent."
            />
          </Section>
        ) : (
          <Section>
            {chats.map((c) => (
              <SwipeActions key={c.id}>
                <Button modifiers={[buttonStyle('plain')]} onPress={() => onSelect(c.id)}>
                  <HStack spacing={10}>
                    <Image
                      systemName={c.active ? 'checkmark.circle.fill' : 'bubble.left'}
                      size={16}
                      color={c.active ? '#10b981' : '#71717a'}
                    />
                    <Text>{c.title}</Text>
                    <Spacer />
                    <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                      {c.subtitle}
                    </Text>
                  </HStack>
                </Button>
                <SwipeActions.Actions edge="trailing">
                  <Button
                    role="destructive"
                    systemImage="trash"
                    label="Delete"
                    onPress={() => onDelete(c.id)}
                  />
                </SwipeActions.Actions>
              </SwipeActions>
            ))}
          </Section>
        )}
      </Form>
    </Host>
  );
}
