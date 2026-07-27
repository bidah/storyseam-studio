import { Stack } from 'expo-router';

// Nested stack INSIDE the Settings formSheet (registered in the root _layout as
// a single-detent formSheet). Because this stack lives inside the sheet, pushing
// the provider-key screen navigates WITHIN the same sheet — a native slide with
// a Back button — instead of stacking a second sheet on top. That sidesteps the
// two-swipe-to-dismiss trap a focused text field creates in its own formSheet:
// here the key screen is left with Back, and its input can safely autofocus.
//
// These options are deliberately STATIC — no `useColors()`, no theme-derived
// colors. react-native-screens drops the large title when the header config is
// re-applied on an already-presented screen inside a formSheet: the "Settings"
// headline is laid out (it stays in the a11y tree) but never painted, in every
// scheme and whatever color you give it. Re-rendering this layout on a theme
// flip was enough to trigger it, so the header instead inherits its colors from
// UIKit — which follows the app's theme because the root layout pushes the
// preference down with `Appearance.setColorScheme` (see lib/theme). Inside a
// formSheet that default is systemGroupedBackground, i.e. the grouped Form
// background the settings form already paints.
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Settings', headerLargeTitle: true }} />
      <Stack.Screen name="provider-key" options={{ title: 'API key' }} />
      <Stack.Screen name="search-key" options={{ title: 'Search key' }} />
      <Stack.Screen name="style-prompts" options={{ title: 'Style presets' }} />
      <Stack.Screen name="style-prompt" options={{ title: 'Style preset' }} />
      <Stack.Screen name="sheet-prompt" options={{ title: 'Sheet prompt' }} />
    </Stack>
  );
}
