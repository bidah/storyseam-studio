import { Stack } from 'expo-router';
import { useColors } from '@/lib/colors';

// Nested stack INSIDE the Chats formSheet (registered in chat/_layout as a
// single-detent formSheet). Because this stack lives inside the sheet, it draws
// the sheet's own header ("Chats" large title) within the sheet content — the
// same trick the Settings sheet uses (see settings/_layout). Match the app's
// page background (nav headers otherwise default to the iOS
// systemGroupedBackground gray inside a formSheet).
export default function ChatHistoryLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.pageBg },
        headerLargeStyle: { backgroundColor: colors.pageBg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.pageBg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Chats', headerLargeTitle: true }} />
    </Stack>
  );
}
