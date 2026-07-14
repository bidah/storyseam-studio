import { Stack } from 'expo-router';

export default function EpisodeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0b' } }} />
  );
}
