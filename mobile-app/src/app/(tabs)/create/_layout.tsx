import { Stack } from 'expo-router';
import { useHeaderBase, useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// The Create tab — the app's front door, the mobile twin of the web root `/`:
// a prompt in, a Film back. Its own stack, independent of the studio's:
//
//   index     — the prompt box, its options, the studio-agent card and the
//               author's latest stories.
//   [filmId]  — one Film being made: each step as it completes, then the video
//               and "Continue working on the video", which hands the Film's
//               project to the Studio tab (the second layer).
//   room      — the Deep writers' room: which specialists read the draft.
//   stories   — Latest stories, a sheet with a native header (title + close).
export default function CreateLayout() {
  const headerOptions = useTabHeaderOptions('', { refresh: false });
  const headerBase = useHeaderBase();
  const colors = useColors();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      <Stack.Screen
        name="[filmId]"
        options={{ ...headerBase, title: '', headerBackButtonDisplayMode: 'minimal' }}
      />
      <Stack.Screen
        name="room"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.75, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="stories"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          headerShown: true,
          headerLargeTitle: false,
        }}
      />
    </Stack>
  );
}
