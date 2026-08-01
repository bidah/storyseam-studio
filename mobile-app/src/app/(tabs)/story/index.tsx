import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useReportSegment } from '@/lib/screen-report';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { WorldSurface } from '@/components/story/world';
import { ScriptSurface } from '@/components/story/script';
import { ShotsSurface } from '@/components/story/shots';

// STORY tab — World | Script | Shot List, the writing half of the pipeline.
// ?segment=world|script|shots deep-links straight into a sub-surface.
//
// World is the WRITTEN bible, and only that. It used to carry a second segmented
// control — Written world | Visual world — which meant an image-generation
// composer, its own gallery and its own set of model/aspect/style pickers lived
// two levels down inside the tab whose other two thirds are prose. Visual world
// is now a MODAL (src/app/image/), reached in one tap from the tab bar pill's
// write/image toggle from anywhere in the app; the nodes canvas stays web-only.

type Segment = 'world' | 'script' | 'shots';

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'world', label: 'World' },
  { value: 'script', label: 'Script' },
  { value: 'shots', label: 'Shots' },
];

export default function StoryScreen() {
  const { segment } = useLocalSearchParams<{ segment?: string }>();
  const [seg, setSeg] = useState<Segment>(
    segment === 'script' || segment === 'shots' ? segment : 'world',
  );

  // Tell the agent WHICH of the three surfaces is showing. The tabs layout can
  // only see the route (`/story`), and the switcher below is component state, so
  // without this the agent hydrates the world bible while the author is looking
  // at the shot list.
  useReportSegment({
    view: seg === 'shots' ? 'shotlist' : seg === 'script' ? 'script' : 'world',
    path: '/story',
  });

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerTitle: () => (
            // The @expo/ui Host collapses to 0 width without an explicit size in
            // the nav-bar title slot, so pin a width for it to lay out into.
            <View style={{ width: 260 }}>
              <SegmentedNative size="large" options={SEGMENTS} value={seg} onChange={setSeg} />
            </View>
          ),
        }}
      />
      {seg === 'world' ? (
        <WorldSurface />
      ) : seg === 'script' ? (
        <ScriptSurface />
      ) : (
        <ShotsSurface />
      )}
    </View>
  );
}
