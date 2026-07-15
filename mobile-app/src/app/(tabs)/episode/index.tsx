import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, Film, Play } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { mediaUrl } from '@/lib/api';
import { useProjectResource } from '@/lib/queries';
import {
  signedCount,
  type Bundle,
  type EpisodePayload,
  type Signoff,
  type StillTake,
  type StoryboardPayload,
  type VideoTake,
} from '@/components/episode/prompt';

// Episode tab — one card per multishot bundle; tap opens the bundle detail.

function SignPills({ signoff }: { signoff?: Signoff }) {
  return (
    <View className="flex-row gap-1.5">
      <Badge label="Images" variant={signoff?.images ? 'success' : 'muted'} />
      <Badge label="Prompt" variant={signoff?.prompt ? 'success' : 'muted'} />
      <Badge label="Audio" variant={signoff?.audio ? 'success' : 'muted'} />
    </View>
  );
}

// Thumbnail: the first (preferably selected) storyboard still for the bundle;
// falls back to a dark placeholder with a Play/Film glyph when only video
// takes (no cheap poster frame) or nothing exists yet.
function BundleThumb({ still, takes }: { still: StillTake | null; takes: VideoTake[] }) {
  if (still) {
    return (
      <Image
        source={{ uri: mediaUrl(still.url) }}
        style={{ width: 92, height: 60, borderRadius: 10 }}
        contentFit="cover"
      />
    );
  }
  return (
    <View className="h-[60px] w-[92px] items-center justify-center rounded-[10px] bg-secondary">
      {takes.length > 0 ? <Play size={20} color="#10b981" /> : <Film size={20} color="#52525b" />}
    </View>
  );
}

export default function EpisodeIndex() {
  const ep = useProjectResource<EpisodePayload>('episode');
  const sb = useProjectResource<StoryboardPayload>('storyboard');

  const epRefetch = ep.refetch;
  const sbRefetch = sb.refetch;
  const onRefresh = useCallback(() => {
    epRefetch();
    sbRefetch();
  }, [epRefetch, sbRefetch]);

  const bundles = ep.data?.episode?.bundles ?? [];
  const videos = ep.data?.video ?? {};
  const signoffs = ep.data?.signoffs ?? {};
  const stills = sb.data?.stills ?? {};

  const stillFor = (bundleId: string): StillTake | null => {
    const shots = stills[bundleId];
    if (!shots) return null;
    let first: StillTake | null = null;
    for (const takes of Object.values(shots)) {
      for (const t of takes) {
        if (t.selected) return t;
        if (!first) first = t;
      }
    }
    return first;
  };

  const renderItem = ({ item: b }: { item: Bundle }) => {
    const takes = videos[b.id] ?? [];
    const signoff = signoffs[b.id];
    const signed = signedCount(signoff);
    return (
      <Pressable
        accessibilityRole="button"
        className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3 active:bg-secondary"
        onPress={() => router.push(`/episode/${b.id}`)}
      >
        <BundleThumb still={stillFor(b.id)} takes={takes} />
        <View className="flex-1 gap-1.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge label={b.id} variant="outline" />
            <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={1}>
              {b.beatTitle || b.beat || ''}
            </Text>
          </View>
          <Text className="text-[12px] text-muted-foreground">
            {b.shots.length} shots · ~{b.durationEst ?? '?'}s → {b.duration ?? '?'}s
            {takes.length > 0 ? ` · ${takes.length} take${takes.length > 1 ? 's' : ''}` : ''}
            {signed === 3 ? ' · signed' : ''}
          </Text>
          <SignPills signoff={signoff} />
        </View>
        <ChevronRight size={18} color="#52525b" />
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-background">
      {ep.isPending ? (
        <Loading />
      ) : ep.isError ? (
        <ErrorNote message={(ep.error as Error)?.message || 'Failed to load episode'} onRetry={onRefresh} />
      ) : bundles.length === 0 ? (
        <Empty title="No episode plan yet" hint="Generate the shot list first — the bundles appear here." />
      ) : (
        <FlatList
          data={bundles}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerClassName="px-4 pb-24 pt-3"
          ListHeaderComponent={
            <Text className="mb-3 text-[13px] text-muted-foreground">
              {ep.data?.episode?.title ? `${ep.data.episode.title} · ` : ''}
              {bundles.length} multishot bundles · {ep.data?.episode?.totalShots ?? 0} shots total
            </Text>
          }
          refreshControl={
            <RefreshControl refreshing={ep.isRefetching || sb.isRefetching} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}
