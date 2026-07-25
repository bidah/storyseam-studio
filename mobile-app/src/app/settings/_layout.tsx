import { Stack } from 'expo-router';
import { useColors } from '@/lib/colors';

// Nested stack INSIDE the Settings formSheet (registered in the root _layout as
// a single-detent formSheet). Because this stack lives inside the sheet, pushing
// the provider-key screen navigates WITHIN the same sheet — a native slide with
// a Back button — instead of stacking a second sheet on top. That sidesteps the
// two-swipe-to-dismiss trap a focused text field creates in its own formSheet:
// here the key screen is left with Back, and its input can safely autofocus.
// Match the grouped Form background so the large-title header blends into the
// list (nav headers otherwise default to the iOS systemGroupedBackground gray
// inside a formSheet). The tint/title colors are set explicitly: without them
// the native title follows the OS appearance, which renders white-on-white when
// the JS theme is forced Light while the device is in Dark mode.
export default function SettingsLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.groupedBg },
        headerLargeStyle: { backgroundColor: colors.groupedBg },
        headerShadowVisible: false,
        headerTintColor: colors.foreground,
        headerTitleStyle: { color: colors.foreground },
        headerLargeTitleStyle: { color: colors.foreground },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings', headerLargeTitle: true }} />
      <Stack.Screen name="provider-key" options={{ title: 'API key' }} />
    </Stack>
  );
}
