import { Stack } from 'expo-router';

// Nested stack INSIDE the Chats formSheet (registered in chat/_layout as a
// single-detent formSheet). Because this stack lives inside the sheet, it draws
// the sheet's own header ("Chats" large title) within the sheet content — the
// same trick the Settings sheet uses (see settings/_layout), including its
// rule: keep these options STATIC. A theme-derived color here re-applies the
// header config on an already-presented screen, and react-native-screens then
// stops painting the large title. UIKit supplies the colors instead — the root
// layout keeps the native appearance in sync with the theme preference.
export default function ChatHistoryLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Chats', headerLargeTitle: true }} />
    </Stack>
  );
}
