import { Stack } from 'expo-router';
import { tabHeaderOptions } from '@/components/header-buttons';

// Nested Stack so the Assets tab gets a native expo-router header.
export default function AssetsLayout() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={tabHeaderOptions('Assets')} />
    </Stack>
  );
}
