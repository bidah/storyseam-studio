import { Stack } from 'expo-router';
import { HEADER_BASE, MenuButton, useMenuItem } from '@/components/header-buttons';

// Nested Stack so the Chat tab gets a native expo-router header. The message
// stream reads better with a compact title than a large one, so large title is
// off here; the menu (liquid-glass context menu) lives on the left, history +
// new chat are set from the screen (they need live chat state).
export default function ChatLayout() {
  const menuItem = useMenuItem();
  return (
    <Stack
      screenOptions={{
        ...HEADER_BASE,
        headerLargeTitle: false,
        title: 'Chat',
        unstable_headerLeftItems: () => [menuItem],
        headerLeft: () => <MenuButton />,
      }}
    >
      <Stack.Screen name="index" />
      {/* Chat history — a full-size formSheet (single detent: opens fully,
          swipe-down closes fully). Its header + rows live in the nested
          history/_layout stack, so headerShown is off here — same pattern as
          the Settings sheet. Registered in this stack (not the root) so it
          renders inside <AgentProvider> and can read the conversation store. */}
      <Stack.Screen
        name="history"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          headerShown: false,
        }}
      />
    </Stack>
  );
}
