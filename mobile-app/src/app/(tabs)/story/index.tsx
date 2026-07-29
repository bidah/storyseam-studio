import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useReportSegment } from '@/lib/screen-report';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { WorldSurface } from '@/components/story/world';
import { VisualWorldSurface } from '@/components/story/visual-world';
import { ScriptSurface } from '@/components/story/script';
import { ShotsSurface } from '@/components/story/shots';

// STORY tab — World | Script | Shot List, the writing half of the pipeline.
// ?segment=world|script|shots deep-links straight into a sub-surface.
// World splits again into Written world | Visual world (web parity: the World
// tab's written bible vs. the concept-image explorer; nodes stays web-only);
// ?world=visual deep-links straight into the visual surface.

type Segment = 'world' | 'script' | 'shots';

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'world', label: 'World' },
  { value: 'script', label: 'Script' },
  { value: 'shots', label: 'Shots' },
];

type WorldView = 'written' | 'visual';

const WORLD_VIEWS: { value: WorldView; label: string }[] = [
  { value: 'written', label: 'Written world' },
  { value: 'visual', label: 'Visual world' },
];

// World sub-surface: the written bible or the visual (image-generation) world.
// Same native segmented row as the Sounds section's Music|SFX|Voice switcher.
function WorldTab({ initialView }: { initialView: WorldView }) {
  const [view, setView] = useState<WorldView>(initialView);
  return (
    <View className="flex-1">
      <View className="px-4 pt-3">
        <SegmentedNative<WorldView> options={WORLD_VIEWS} value={view} onChange={setView} />
      </View>
      {view === 'written' ? <WorldSurface /> : <VisualWorldSurface />}
    </View>
  );
}

export default function StoryScreen() {
  const { segment, world } = useLocalSearchParams<{ segment?: string; world?: string }>();
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
    ...(seg === 'world' && world === 'visual' ? { pane: 'visual' } : {}),
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
        // Keyed by the param so a later ?world= deep link re-seeds the view
        // (the segmented control still owns it in between).
        <WorldTab key={world || 'none'} initialView={world === 'visual' ? 'visual' : 'written'} />
      ) : seg === 'script' ? (
        <ScriptSurface />
      ) : (
        <ShotsSurface />
      )}
    </View>
  );
}
