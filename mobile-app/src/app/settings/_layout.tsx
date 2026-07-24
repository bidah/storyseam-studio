import { Stack } from 'expo-router';

// Nested stack INSIDE the Settings formSheet (registered in the root _layout as
// a single-detent formSheet). Because this stack lives inside the sheet, pushing
// the provider-key screen navigates WITHIN the same sheet — a native slide with
// a Back button — instead of stacking a second sheet on top. That sidesteps the
// two-swipe-to-dismiss trap a focused text field creates in its own formSheet:
// here the key screen is left with Back, and its input can safely autofocus.
// Match the app's near-black page background (nav headers otherwise default to
// the iOS systemGroupedBackground gray inside a formSheet).
const PAGE_BG = '#0a0a0b';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: PAGE_BG },
        headerLargeStyle: { backgroundColor: PAGE_BG },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings', headerLargeTitle: true }} />
      <Stack.Screen name="provider-key" options={{ title: 'API key' }} />
    </Stack>
  );
}
