import { Stack } from 'expo-router';
import { tabHeaderOptions } from '@/components/header-buttons';

// Nested Stack so the Cuts tab gets a native expo-router header.
export default function CutsLayout() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={tabHeaderOptions('Cuts')} />
    </Stack>
  );
}
