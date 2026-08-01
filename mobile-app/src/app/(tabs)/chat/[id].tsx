import { useLocalSearchParams } from 'expo-router';
import { Conversation } from '@/components/chat/conversation';

// One conversation, PUSHED inside the Home tab's stack — the presentation that
// earns the native header morph (see ./_layout.tsx).
//
// No longer the primary path: every in-app "open this chat" now presents the chat
// modal instead (src/app/session/[id].tsx — same component below, same shared flue
// session), so that reaching the agent never costs you the tab you were working in
// (lib/agent/chat-route.ts). This route stays as the URL/deep-link host for
// `/chat/<id>`, and as the in-stack presentation to fall back to if the modal ever
// stops being the right call.
export default function ConversationScreen() {
  const { id, focus, draft, dk } = useLocalSearchParams<{
    id: string;
    focus?: string;
    draft?: string;
    dk?: string;
  }>();
  // `draft`/`dk` (a dictated hand-off — see lib/agent/voice-capture.tsx) are read
  // here too so this route stays the modal's equal: nothing currently sends them
  // this way, but the two hosts of <Conversation> must not drift.
  return (
    <Conversation id={id} hubHref="/(tabs)/chat" focus={focus === '1'} draft={draft} draftKey={dk} />
  );
}
