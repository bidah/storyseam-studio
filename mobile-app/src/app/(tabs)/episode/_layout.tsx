import { Stack } from 'expo-router';
import { tabHeaderOptions } from '@/components/header-buttons';

// Episode Stack: the list (index) gets the native tab header; the bundle detail
// ([bundleId]) keeps its own in-screen header, so it opts out of the native one.
export default function EpisodeLayout() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={tabHeaderOptions('Episode')} />
      <Stack.Screen name="[bundleId]" options={{ headerShown: false }} />
    </Stack>
  );
}
