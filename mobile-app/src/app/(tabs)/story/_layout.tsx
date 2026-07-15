import { Stack } from 'expo-router';
import { tabHeaderOptions } from '@/components/header-buttons';

// Nested Stack so the Story tab gets a native expo-router header (large title +
// project switcher + refresh/settings). See src/components/header-buttons.tsx.
export default function StoryLayout() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={tabHeaderOptions('Story')} />
    </Stack>
  );
}
