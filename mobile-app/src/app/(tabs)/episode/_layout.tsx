import { Stack } from 'expo-router';
import { useHeaderBase, useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// Episode Stack: the list (index) gets the native tab header; the bundle detail
// ([bundleId]) pushes with a native header too — a native back button + the beat
// title (set from the screen), with the Stills/Video segmented control living as
// a sub-nav below it. `headerBackButtonDisplayMode: 'minimal'` drops the back
// label so it's just the chevron — more breathing room for the beat title.
export default function EpisodeLayout() {
  const headerOptions = useTabHeaderOptions('Episode', { refresh: false });
  const headerBase = useHeaderBase();
  const colors = useColors();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      <Stack.Screen
        name="[bundleId]"
        options={{ ...headerBase, headerBackButtonDisplayMode: 'minimal' }}
      />
    </Stack>
  );
}
