import { Stack } from 'expo-router';
import { useTabHeaderOptions } from '@/components/header-buttons';

// Nested Stack so the Assets tab gets a native expo-router header (project switcher
// + refresh/settings). See src/components/header-buttons.tsx.
export default function AssetsLayout() {
  const headerOptions = useTabHeaderOptions('Assets');
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={headerOptions} />
    </Stack>
  );
}
