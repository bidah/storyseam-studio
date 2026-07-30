import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SquarePen } from 'lucide-react-native';
import { useConversations } from '@/lib/agent/provider';
import { relTime } from '@/components/chat/helpers';
import { useChatColors } from '@/components/chat/theme';
import ChatHistoryForm from '@/components/chat-history-form';

// The Chats sheet's BODY — the list, the delete, the New chat bar button. State
// only; the UI is ChatHistoryForm (a native SwiftUI Form on iOS, RN cards
// elsewhere).
//
// Two routes host it, because a formSheet is presented by the stack it's
// registered in and there are two chat stacks: the Chat tab's
// (src/app/(tabs)/chat/history) and the chat modal's (src/app/session/history).
// They differ ONLY in where leaving the sheet lands, so that is the prop:
//
//   `leaveTo(id)`  — dismiss, and show that conversation
//   `leaveTo()`    — dismiss, and put the user on a new/blank chat
//
// Both actions NAVIGATE rather than mutate the active chat in place, since a
// conversation is its own route.

export function ChatHistorySheetBody({ leaveTo }: { leaveTo: (chatId?: string) => void }) {
  const chatC = useChatColors();
  const conv = useConversations();

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
