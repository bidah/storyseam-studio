import { Stack } from 'expo-router';
import { HEADER_BASE, ProjectSwitcherButton } from '@/components/header-buttons';

// Nested Stack so the Chat tab gets a native expo-router header. The message
// stream reads better with a compact title than a large one, so large title is
// off here; project switcher lives in headerLeft, the rest (model · history ·
// new chat) is set as headerRight from the screen (it needs live chat state).
export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        ...HEADER_BASE,
        headerLargeTitle: false,
        title: 'Chat',
        headerLeft: () => <ProjectSwitcherButton />,
      }}
    />
  );
}
