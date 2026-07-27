import { useLocalSearchParams } from 'expo-router';
import { Conversation } from '@/components/chat/conversation';

// One conversation, inside the chat modal — the same component the Home tab
// pushes (src/app/(tabs)/chat/[id].tsx), reading the same shared flue session.
// This is what the accessory pill opens from every tab but Home.
//
// `suppressAccessory={false}`: the modal already covers the tab bar, and taking
// the pill away would re-lay the bar underneath and animate it back in on dismiss.
// `hubHref` is where a chat that disappears (deleted from the history sheet, or the
// project switched out from under it) sends us — the Home tab's hub, since this
// modal has nothing beneath it.
export default function SessionConversationScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  return (
    <Conversation
      id={id}
      hubHref="/(tabs)/chat"
      focus={focus === '1'}
      suppressAccessory={false}
    />
  );
}
