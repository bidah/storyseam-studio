import { Stack } from 'expo-router';
import { useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// Nested Stack so the Cuts tab gets a native expo-router header (project switcher
// + refresh/settings). See src/components/header-buttons.tsx.
export default function CutsLayout() {
  const headerOptions = useTabHeaderOptions('Cuts');
  const colors = useColors();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      {/* Radio + animatic live under Cuts rather than as a sixth tab: iOS
          collapses past five into a "More" list, and both of this screen's
          outputs land in the Editor, which Cuts already opens. */}
      <Stack.Screen name="radio" options={{ title: 'Radio version', headerBackTitle: 'Cuts' }} />
    </Stack>
  );
}
