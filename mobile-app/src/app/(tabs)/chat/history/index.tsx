import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SquarePen } from 'lucide-react-native';
import { useConversations } from '@/lib/agent/provider';
import { relTime } from '@/components/chat/helpers';
import { useChatColors } from '@/components/chat/theme';
import ChatHistoryForm from '@/components/chat-history-form';

// The Chats sheet — a full-size formSheet (single detent) presented from the
// Chat tab's stack, so it lives inside <AgentProvider> and can read the shared
// conversation store. State + navigation only; the UI is ChatHistoryForm (a
// native SwiftUI Form on iOS, RN cards elsewhere).
//
// Both actions here NAVIGATE rather than mutate the active chat in place, since
// a conversation is its own route now: selecting one lands on it, and New chat
// lands on the tab's landing screen (which IS the new chat — nothing to disable).
// Both first unwind to that landing screen, so picking a chat from inside a chat
// swaps rather than stacking a second conversation behind you.
export default function ChatHistorySheet() {
  const chatC = useChatColors();
  const conv = useConversations();

  // Dismiss the sheet AND pop back to the tab's landing screen, then optionally
  // push a conversation. The push waits a frame: dismissing a formSheet is a
  // native transition, and dispatching the push in the same tick can be
  // swallowed by it.
  const leaveTo = useCallback((chatId?: string) => {
    router.dismissTo('/(tabs)/chat');
    if (chatId) requestAnimationFrame(() => router.push(`/(tabs)/chat/${chatId}`));
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      Haptics.selectionAsync().catch(() => {});
      leaveTo(id);
    },
    [leaveTo],
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
    leaveTo();
  }, [leaveTo]);

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
              <SquarePen size={18} color={chatC.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      <ChatHistoryForm chats={chats} onSelect={onSelect} onDelete={onDelete} />
    </>
  );
}
