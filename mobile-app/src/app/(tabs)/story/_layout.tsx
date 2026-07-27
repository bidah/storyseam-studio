import { Stack } from 'expo-router';
import { useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// Nested Stack so the Story tab gets a native expo-router header (project switcher
// + refresh/settings). See src/components/header-buttons.tsx.
export default function StoryLayout() {
  const headerOptions = useTabHeaderOptions('Story', { refresh: false });
  const colors = useColors();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      {/* Drafts — a native formSheet. Its "Drafts" title + close button live in
          the nested drafts/_layout stack, so headerShown is off here (same
          pattern as the Settings sheet / Chat history). */}
      <Stack.Screen
        name="drafts"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          headerShown: false,
        }}
      />
      {/* Shot editor — same native formSheet treatment as Drafts; its title +
          close button live in the nested shot/_layout stack. */}
      <Stack.Screen
        name="shot"
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
