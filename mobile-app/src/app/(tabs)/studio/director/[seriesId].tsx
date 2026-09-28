import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { ImageOff, ListRestart, Star, TriangleAlert, X } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { ErrorNote, Loading } from '@/components/ui/empty';
import { TakeAudioProvider, TakePlayButton } from '@/components/radio/take-player';
import { mediaUrl, postJson, putJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { beatText, mmss, useSeries, type DirectorIndex, type SeriesView, type Sitting } from '@/lib/director';
import { StageVideo } from '@/components/studio/stage-video';
import { useProjectStore } from '@/lib/project';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// One Series — its recipe, read on a phone: the screening it would make (reels,
// length), what the endpoint would refuse (`issues`, which kill the whole
// session at configure), the cue sheet with its pinned frames, the model
// sheets, and the target audio. The phone acts on it where one tap does:
// select it, derive the cue sheet from the Shot list, clear a pin. Typing a
// cue sheet out stays on the web studio (or the agent).

export default function SeriesScreen() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const projectId = useProjectStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const index = useProjectResource<DirectorIndex>('director');
  const sittings = useProjectResource<{ kept: Sitting[] }>('sittings');
  const { data, isLoading, error, refetch } = useSeries(seriesId);
  const { refreshing, onRefresh } = useManualRefresh(refetch, index.refetch);
  const [busy, setBusy] = useState<string | null>(null);

  // Every write answers with the fresh SeriesView — put it straight in the cache.
  const act = async (key: string, fn: () => Promise<SeriesView | unknown>, done?: string) => {
    setBusy(key);
    try {
      const view = (await fn()) as SeriesView | undefined;
      if (view && (view as SeriesView).series) {
        queryClient.setQueryData([projectId, 'director', seriesId], view);
      } else {
        await refetch();
      }
      invalidate('director');
      if (done) toast.success(done);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const base = `/api/director/series/${encodeURIComponent(seriesId || '')}`;
  const series = data?.series;
  const selected = index.data?.selectedId === seriesId;
  const issues = Object.entries(data?.issues ?? {});
  const beats = [...(series?.directions ?? [])].sort((a, b) => a.offset - b.offset);
  const aspect = series?.aspectRatio === '9:16' ? 9 / 16 : 16 / 9;

  const screen = <Stack.Screen options={{ title: series?.title || 'Series' }} />;
  if (isLoading && !data) return (<>{screen}<Loading /></>);
  if (error && !data) {
    return (
      <>
        {screen}
        <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />
      </>
    );
  }
  if (!series) return screen;

  const derive = () =>
    Alert.alert(
      'Derive the cue sheet?',
      'Builds the cue sheet from the Shot list and pins the frames it can. It replaces the beats this Series has now.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Derive',
          onPress: () => act('derive', () => postJson(`${base}/derive`, { pin: true }), 'Cue sheet derived from the Shot list'),
        },
      ],
    );

  const clearPin = (offset: number) =>
    Alert.alert(`Clear the pin at ${mmss(offset)}?`, 'The frame is unpinned; the beat stays.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear pin',
        style: 'destructive',
        onPress: () => act(`pin-${offset}`, () => postJson(`${base}/pin`, { offset, clear: true })),
      },
    ]);

  const screeningReels = data?.screening?.reels;
  const reelCount = Array.isArray(screeningReels)
    ? screeningReels.length
    : typeof screeningReels === 'number'
      ? screeningReels
      : (data?.reels?.length ?? 0);
  const kept = (sittings.data?.kept ?? [])
    .filter((k) => k.seriesId === series.id)
    .sort((a, b) => Number(new Date(b.recordedAt ?? 0)) - Number(new Date(a.recordedAt ?? 0)))[0];
  const film = kept ? kept.scoredUrl || kept.url : null;

  return (
    <TakeAudioProvider>
      {screen}
      <ScrollView
        {...barInset}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
      >
        {/* The recipe at a glance */}
        <Card style={styles.gap8}>
          {/* What this Series has actually made comes first: the newest kept
              sitting, scored if it was — a Film's picture. The opening frame is
              the stand-in only until something has been filmed. */}
          {film ? (
            <StageVideo url={film} aspectRatio={aspect} />
          ) : series.imageUrl ? (
            <Image
              source={{ uri: mediaUrl(series.imageUrl) }}
              style={[styles.opening, { aspectRatio: aspect }]}
              contentFit="cover"
              accessibilityLabel="Opening frame"
            />
          ) : null}
          <View style={styles.badges}>
            {selected ? <Badge variant="info" label="selected" /> : null}
            <Badge variant={series.status === 'published' ? 'success' : 'muted'} label={series.status} />
            <Badge variant="outline" label={`${series.aspectRatio} · ${series.resolution}`} />
            {reelCount ? (
              <Badge variant="outline" label={`${reelCount} reel${reelCount === 1 ? '' : 's'}`} />
            ) : null}
            {data?.screening?.filmSeconds ? <Badge variant="outline" label={mmss(data.screening.filmSeconds)} /> : null}
          </View>
          <Text style={styles.prompt}>{series.prompt}</Text>
          <View style={styles.actions}>
            {!selected ? (
              <Button
                size="sm"
                variant="outline"
                title="Make selected"
                loading={busy === 'select'}
                onPress={() =>
                  act('select', () => putJson('/api/director/selected', { seriesId }), 'Selected for Stage and Shot sheet')
                }
              >
                <Star size={14} color={colors.foreground} />
              </Button>
            ) : null}
            <Button size="sm" variant="outline" title="Derive from Shot list" loading={busy === 'derive'} onPress={derive}>
              <ListRestart size={14} color={colors.foreground} />
            </Button>
          </View>
        </Card>

        {/* What the endpoint would refuse — a session dies whole on any of these. */}
        {issues.length > 0 ? (
          <Card style={[styles.gap8, styles.warnCard]}>
            <View style={styles.rowCenter}>
              <TriangleAlert size={16} color={colors.amber} />
              <Text style={styles.warnTitle}>The Director would refuse this Series</Text>
            </View>
            {issues.map(([field, msg]) => (
              <Text key={field} style={styles.warnLine}>
                <Text style={styles.bold}>{field}: </Text>
                {msg}
              </Text>
            ))}
          </Card>
        ) : (
          <Text style={styles.ok}>Ready for a sitting — nothing here breaks a ceiling.</Text>
        )}

        {/* Target audio */}
        {series.audioUrl ? (
          <Card style={styles.rowCenter}>
            <TakePlayButton url={series.audioUrl} label="target audio" />
            <Text style={styles.flex1Text}>Target audio</Text>
          </Card>
        ) : null}

        {/* Cue sheet */}
        <Eyebrow style={styles.mt}>Cue sheet · {beats.length} beats</Eyebrow>
        {beats.length === 0 ? (
          <Text style={styles.muted}>No beats yet. Derive them from the Shot list, or ask the agent.</Text>
        ) : (
          beats.map((b) => (
            <Card key={b.offset} style={styles.beat}>
              {b.endImageUrl ? (
                <Image source={{ uri: mediaUrl(b.endImageUrl) }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <ImageOff size={16} color={colors.subtleForeground} />
                </View>
              )}
              <View style={styles.flex1}>
                <Text style={styles.offset}>{mmss(b.offset)}</Text>
                <Text style={styles.beatText} numberOfLines={4}>
                  {beatText(b.prompt) || '—'}
                </Text>
              </View>
              {b.endImageUrl ? (
                <Button
                  size="icon"
                  variant="ghost"
                  accessibilityLabel={`Clear the pin at ${mmss(b.offset)}`}
                  loading={busy === `pin-${b.offset}`}
                  onPress={() => clearPin(b.offset)}
                >
                  {busy === `pin-${b.offset}` ? null : <X size={16} color={colors.mutedForeground} />}
                </Button>
              ) : null}
            </Card>
          ))
        )}

        {/* Model sheets */}
        <Eyebrow style={styles.mt}>Model sheets · {series.modelSheets?.length ?? 0}</Eyebrow>
        {(series.modelSheets ?? []).length === 0 ? (
          <Text style={styles.muted}>No model sheets. The Bible, Images and Library supply them.</Text>
        ) : (
          <View style={styles.grid}>
            {series.modelSheets.map((m) => (
              <View key={`${m.kind}-${m.name}`} style={styles.sheet}>
                {m.imageUrl ? (
                  <Image source={{ uri: mediaUrl(m.imageUrl) }} style={styles.sheetImg} contentFit="cover" />
                ) : (
                  <View style={[styles.sheetImg, styles.thumbEmpty]}>
                    <ImageOff size={18} color={colors.subtleForeground} />
                  </View>
                )}
                <Text style={styles.sheetName} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={styles.sheetKind}>{m.kind}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </TakeAudioProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  gap8: { gap: 8 },
  mt: { marginTop: 8, marginBottom: 0 },
  opening: { width: '100%', borderRadius: 0, backgroundColor: theme.colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  prompt: { fontSize: 14, lineHeight: 20, color: theme.colors.foreground },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warnCard: { borderColor: theme.colors.warning },
  warnTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.foreground },
  warnLine: { fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  bold: { fontWeight: '600', color: theme.colors.foreground },
  ok: { fontSize: 13, color: theme.colors.success },
  muted: { fontSize: 13, color: theme.colors.mutedForeground },
  flex1: { flex: 1, gap: 2 },
  flex1Text: { flex: 1, fontSize: 14, color: theme.colors.foreground },
  beat: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  thumb: { width: 72, height: 44, borderRadius: 0, backgroundColor: theme.colors.muted },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  offset: { fontSize: 12, fontWeight: '600', color: theme.colors.primary, fontVariant: ['tabular-nums'] },
  beatText: { fontSize: 13, lineHeight: 18, color: theme.colors.foreground },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sheet: { width: '30%', gap: 4 },
  sheetImg: { width: '100%', aspectRatio: 1, borderRadius: 0, backgroundColor: theme.colors.muted },
  sheetName: { fontSize: 12, fontWeight: '600', color: theme.colors.foreground },
  sheetKind: { fontSize: 11, color: theme.colors.mutedForeground },
}));
