import { Stack } from 'expo-router';
import { useHeaderBase, useTabHeaderOptions } from '@/components/header-buttons';
import { useColors } from '@/lib/colors';

// The Studio tab: the second layer, where a Film (or any project) is worked
// on further. It folds what used to be two tabs — Episode and Cuts — together
// with the installed plugins' surfaces behind one hub (index), because iOS
// collapses a sixth tab into "More" and Create now takes a slot.
//
// Every surface is a push from the hub with a native back chevron; the route
// segment of a plugin surface IS its plugin id (director, stage, shotsheet,
// musicalized, upscale), the same string the web uses as its URL and `view`.
export default function StudioLayout() {
  const headerOptions = useTabHeaderOptions('Studio');
  const headerBase = useHeaderBase();
  const colors = useColors();
  const pushed = { ...headerBase, headerBackButtonDisplayMode: 'minimal' as const };
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.pageBg } }}>
      <Stack.Screen name="index" options={headerOptions} />
      <Stack.Screen name="episode/index" options={{ ...pushed, title: 'Episodes' }} />
      <Stack.Screen name="episode/[bundleId]" options={pushed} />
      <Stack.Screen name="cuts" options={{ ...pushed, title: 'Complete cuts' }} />
      <Stack.Screen name="radio" options={{ ...pushed, title: 'Radio version' }} />
      <Stack.Screen name="director/index" options={{ ...pushed, title: 'Director' }} />
      <Stack.Screen name="director/[seriesId]" options={{ ...pushed, title: 'Series' }} />
      <Stack.Screen name="stage" options={{ ...pushed, title: 'Stage' }} />
      <Stack.Screen name="shotsheet" options={{ ...pushed, title: 'Shot sheet' }} />
      <Stack.Screen name="musicalized" options={{ ...pushed, title: 'Musicalized' }} />
      <Stack.Screen name="upscale" options={{ ...pushed, title: 'Upscale' }} />
      <Stack.Screen name="plugins" options={{ ...pushed, title: 'Plugins' }} />
    </Stack>
  );
}
