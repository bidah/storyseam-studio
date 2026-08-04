import { FlatList, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, Film, Play } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { mediaUrl } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
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
    <View style={styles.pills}>
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
  const colors = useColors();
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
    <View style={styles.thumbPlaceholder}>
      {takes.length > 0 ? <Play size={20} color={colors.primary} /> : <Film size={20} color={colors.subtleForeground} />}
    </View>
  );
}

export default function EpisodeIndex() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const ep = useProjectResource<EpisodePayload>('episode');
  const sb = useProjectResource<StoryboardPayload>('storyboard');

  const { refreshing, onRefresh } = useManualRefresh(ep.refetch, sb.refetch);

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
      <BouncyPressable
        accessibilityLabel={`Open ${b.beatTitle || b.beat || b.id}`}
        style={styles.card}
        onPress={() => router.push(`/episode/${b.id}`)}
      >
        <BundleThumb still={stillFor(b.id)} takes={takes} />
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Badge label={b.id} variant="outline" />
            <Text style={styles.title} numberOfLines={1}>
              {b.beatTitle || b.beat || ''}
            </Text>
          </View>
          <Text style={styles.meta}>
            {b.shots.length} shots · ~{b.durationEst ?? '?'}s → {b.duration ?? '?'}s
            {takes.length > 0 ? ` · ${takes.length} take${takes.length > 1 ? 's' : ''}` : ''}
            {signed === 3 ? ' · signed' : ''}
          </Text>
          <SignPills signoff={signoff} />
        </View>
        <ChevronRight size={18} color={colors.subtleForeground} />
      </BouncyPressable>
    );
  };

  return (
    <View style={styles.root}>
      {ep.isPending ? (
        <Loading />
      ) : ep.isError ? (
        <ErrorNote message={(ep.error as Error)?.message || 'Failed to load episode'} onRetry={onRefresh} />
      ) : bundles.length === 0 ? (
        <Empty title="No episode plan yet" hint="Generate the shot list first — the bundles appear here." />
      ) : (
        <FlatList
          {...barInset}
          data={bundles}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.header}>
              {ep.data?.episode?.title ? `${ep.data.episode.title} · ` : ''}
              {bundles.length} multishot bundles · {ep.data?.episode?.totalShots ?? 0} shots total
            </Text>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  listContent: { paddingHorizontal: 16, paddingBottom: 96, paddingTop: 12 },
  header: { marginBottom: 12, fontSize: 13, color: theme.colors.mutedForeground },
  pills: { flexDirection: 'row', gap: 6 },
  thumbPlaceholder: {
    height: 60,
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.colors.secondary,
  },
  card: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  cardBody: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  meta: { fontSize: 12, color: theme.colors.mutedForeground },
}));
