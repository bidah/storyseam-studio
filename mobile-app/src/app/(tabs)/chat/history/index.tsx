import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SquarePen } from 'lucide-react-native';
import { useConversations } from '@/lib/agent/provider';
import { relTime } from '@/components/chat/helpers';
import { chatColors } from '@/components/chat/theme';
import ChatHistoryForm from '@/components/chat-history-form';

// The Chats sheet — a full-size formSheet (single detent) presented from the
// Chat tab's stack, so it lives inside <AgentProvider> and can read the shared
// conversation store. State + navigation only; the UI is ChatHistoryForm (a
// native SwiftUI Form on iOS, RN cards elsewhere). Selecting a chat switches
// the active conversation and dismisses; the New chat header button mints a
// fresh one and dismisses. The Chat screen's own effect (keyed on activeId)
// remounts the transcript onto whatever this leaves active.
export default function ChatHistorySheet() {
  const conv = useConversations();

  const onSelect = useCallback(
    (id: string) => {
      Haptics.selectionAsync().catch(() => {});
      conv.switchChat(id);
      router.back();
    },
    [conv],
  );

  const onDelete = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      conv.deleteChat(id);
    },
    [conv],
  );

  const onNewChat = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    conv.newChat();
    router.back();
  }, [conv]);

  const chats = conv.list.map((c: { id: string; title?: string; updatedAt?: number }) => ({
    id: c.id,
    title: c.title || 'New chat',
    subtitle: relTime(c.updatedAt),
    active: c.id === conv.activeId,
  }));

  return (
    <>
      <Stack.Screen
        options={{
          // Native bar button item on iOS; the <Pressable> fallback elsewhere.
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: '',
              icon: { type: 'sfSymbol', name: 'square.and.pencil' },
              accessibilityLabel: 'New chat',
              onPress: onNewChat,
            },
          ],
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New chat"
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
              onPress={onNewChat}
            >
              <SquarePen size={18} color={chatColors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      <ChatHistoryForm chats={chats} onSelect={onSelect} onDelete={onDelete} />
    </>
  );
}
