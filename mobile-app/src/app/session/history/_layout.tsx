import { Stack } from 'expo-router';

// Nested stack INSIDE the chat modal's Chats formSheet (registered in
// session/_layout as a single-detent formSheet). Same shape and same rule as the
// Chat tab's copy (see (tabs)/chat/history/_layout): the stack lives inside the
// sheet so it draws the sheet's own header within the sheet content, and these
// options stay STATIC — a theme-derived color here re-applies the header config
// on an already-presented screen, and react-native-screens then stops painting
// the large title. UIKit supplies the colors instead.
export default function SessionChatHistoryLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Chat history', headerLargeTitle: true }} />
    </Stack>
  );
}
