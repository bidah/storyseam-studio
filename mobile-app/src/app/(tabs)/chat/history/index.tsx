import { useCallback } from 'react';
import { router } from 'expo-router';
import { openChatModal } from '@/lib/agent/chat-route';
import { ChatHistorySheetBody } from '@/components/chat/history-sheet';

// The Chats sheet as presented from the Chat TAB — a full-size formSheet (single
// detent) registered in the tab's stack, so it lives inside <AgentProvider> and
// can read the shared conversation store. The list and its actions are shared
// with the chat modal's copy (see components/chat/history-sheet.tsx); this file
// is only the tab's answer to "where does leaving the sheet land".
export default function ChatHistorySheet() {
  // Dismiss the sheet AND pop back to the tab's landing screen, then optionally
  // open a conversation as the modal. Unwinding first means picking a chat from
  // inside this sheet SWAPS rather than stacking anything behind you; landing on
  // the landing screen is also what "New chat" means here — that screen IS the
  // new chat, so there is nothing to mint.
  //
  // The second navigation waits a frame: dismissing a formSheet is a native
  // transition, and presenting the modal in the same tick can be swallowed by it
  // (doubly so now that both ends are modals).
  const leaveTo = useCallback((chatId?: string) => {
    router.dismissTo('/(tabs)/chat');
    if (chatId) requestAnimationFrame(() => openChatModal(chatId));
  }, []);

  return <ChatHistorySheetBody leaveTo={leaveTo} />;
}
