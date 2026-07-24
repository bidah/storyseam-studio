import { Stack } from 'expo-router';
import { useHeaderBase, useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// Nested Stack so the Assets tab gets a native expo-router header (project switcher
// + refresh/settings). See src/components/header-buttons.tsx. The in-folder image
// grid (folder) pushes as its own native screen — the folder name in a native
// header + native back button (label minimal → just the chevron, more room for
// long folder names).
export default function AssetsLayout() {
  const headerOptions = useTabHeaderOptions('Assets', { refresh: false });
  const headerBase = useHeaderBase();
  const colors = useColors();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      <Stack.Screen name="folder" options={{ ...headerBase, headerBackButtonDisplayMode: 'minimal' }} />
    </Stack>
  );
}
