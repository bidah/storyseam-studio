import { Stack } from 'expo-router';
import { HEADER_BASE, useTabHeaderOptions } from '@/components/header-buttons';

// Episode Stack: the list (index) gets the native tab header; the bundle detail
// ([bundleId]) pushes with a native header too — a native back button + the beat
// title (set from the screen), with the Stills/Video segmented control living as
// a sub-nav below it. `headerBackButtonDisplayMode: 'minimal'` drops the back
// label so it's just the chevron — more breathing room for the beat title.
export default function EpisodeLayout() {
  const headerOptions = useTabHeaderOptions('Episode');
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0a0a0b' } }}>
      <Stack.Screen name="index" options={headerOptions} />
      <Stack.Screen
        name="[bundleId]"
        options={{ ...HEADER_BASE, headerBackButtonDisplayMode: 'minimal' }}
      />
    </Stack>
  );
}
