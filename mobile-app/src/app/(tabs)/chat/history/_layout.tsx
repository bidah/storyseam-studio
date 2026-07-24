import { Stack } from 'expo-router';

// Nested stack INSIDE the Chats formSheet (registered in chat/_layout as a
// single-detent formSheet). Because this stack lives inside the sheet, it draws
// the sheet's own header ("Chats" large title) within the sheet content — the
// same trick the Settings sheet uses (see settings/_layout). Match the app's
// near-black page background (nav headers otherwise default to the iOS
// systemGroupedBackground gray inside a formSheet).
const PAGE_BG = '#0a0a0b';

export default function ChatHistoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: PAGE_BG },
        headerLargeStyle: { backgroundColor: PAGE_BG },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: PAGE_BG },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Chats', headerLargeTitle: true }} />
    </Stack>
  );
}
