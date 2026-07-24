import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { WorldSurface } from '@/components/story/world';
import { ScriptSurface } from '@/components/story/script';
import { ShotsSurface } from '@/components/story/shots';

// STORY tab — World | Script | Shot List, the writing half of the pipeline.
// ?segment=world|script|shots deep-links straight into a sub-surface.

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
      {seg === 'world' ? <WorldSurface /> : seg === 'script' ? <ScriptSurface /> : <ShotsSurface />}
    </View>
  );
}
