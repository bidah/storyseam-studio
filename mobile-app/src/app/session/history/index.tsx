import { useCallback } from 'react';
import { router } from 'expo-router';
import { startNewChat } from '@/lib/agent/provider';
import { ChatHistorySheetBody } from '@/components/chat/history-sheet';

// The Chats sheet as presented from the chat MODAL. Same body as the tab's copy
// (components/chat/history-sheet.tsx); what differs is where leaving it lands.
//
// It has to be its own route rather than reusing /(tabs)/chat/history: that one
// belongs to the Chat tab's stack, so opening it from here would make that tab
// current — throwing away the tab the user was standing on, which is the one
// thing the modal exists to prevent (see session/_layout).
//
// The modal has no landing screen underneath, so both actions resolve to a chat
// id and hand it to the modal's single conversation screen. `dismissTo` does both
// halves in one dispatch — the sheet pops and the conversation below it is
// re-pointed at that id (Conversation handles a chat SWITCH in place; it's the
// same path deep links and the tab's sheet already use).
export default function SessionChatHistorySheet() {
  const leaveTo = useCallback((chatId?: string) => {
    // No chat id ⇒ "New chat": reuse the active chat if it's still blank, mint one
    // otherwise (see startNewChat — the same rule the tab's landing screen applies).
    const id = chatId ?? startNewChat();
    if (id) router.dismissTo({ pathname: '/session/[id]', params: { id } });
  }, []);

  return <ChatHistorySheetBody leaveTo={leaveTo} />;
}
