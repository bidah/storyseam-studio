import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { ChevronRight, Clapperboard, Plus } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { Segmented } from '@/components/ui/segmented';
import { postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import type { DirectorIndex, SeriesView } from '@/lib/director';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Director — the project's Series (one recipe each: opening prompt, first
// frame, cue sheet, model sheets, target audio). The list and a quick "new
// Series"; the recipe itself opens in director/[seriesId]. Full cue-sheet
// editing stays on the web studio — the agent can edit it from here too.

type Aspect = '16:9' | '9:16';

export default function DirectorList() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const invalidate = useInvalidate();
  const { data, isLoading, error, refetch } = useProjectResource<DirectorIndex>('director');
  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim() || !prompt.trim()) {
      toast.error('A Series needs a title and an opening prompt.');
      return;
    }
    setBusy(true);
    try {
      const view = await postJson<SeriesView & { ok: boolean }>('/api/director/series', {
        title: title.trim(),
        prompt: prompt.trim(),
        aspectRatio: aspect,
      });
      invalidate('director');
      setCreating(false);
      setTitle('');
      setPrompt('');
      if (view?.series?.id) {
        router.push({ pathname: '/studio/director/[seriesId]', params: { seriesId: view.series.id } });
      }
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading && !data) return <Loading />;
  if (error && !data) {
    return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;
  }

  const series = data?.series ?? [];

  return (
    <ScrollView
      {...barInset}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      {creating ? (
        <Card style={styles.form}>
          <Eyebrow>New Series</Eyebrow>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={colors.subtleForeground}
            style={styles.input}
            accessibilityLabel="Series title"
          />
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Opening prompt — what the first frame shows"
            placeholderTextColor={colors.subtleForeground}
            style={[styles.input, styles.multiline]}
            multiline
            accessibilityLabel="Opening prompt"
          />
          <Segmented<Aspect>
            options={[
              { value: '16:9', label: 'Landscape 16:9' },
              { value: '9:16', label: 'Portrait 9:16' },
            ]}
            value={aspect}
            onChange={setAspect}
          />
          <View style={styles.formActions}>
            <Button variant="ghost" size="sm" title="Cancel" onPress={() => setCreating(false)} />
            <Button size="sm" title="Create" loading={busy} onPress={create} />
          </View>
        </Card>
      ) : (
        <Button variant="outline" title="New Series" onPress={() => setCreating(true)}>
          <Plus size={16} color={colors.foreground} />
        </Button>
      )}

      {series.length === 0 ? (
        <Empty
          title="No Series yet"
          hint="A Series is one recipe the live Director generates against. Create one here or ask the agent."
        />
      ) : (
        series.map((s) => (
          <BouncyPressable
            key={s.id}
            accessibilityLabel={`Open ${s.title}`}
            onPress={() => router.push({ pathname: '/studio/director/[seriesId]', params: { seriesId: s.id } })}
          >
            <Card style={styles.row}>
              <View style={styles.iconBox}>
                <Clapperboard size={18} color={colors.primary} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.title} numberOfLines={1}>
                  {s.title || 'Untitled Series'}
                </Text>
                <Text style={styles.meta}>
                  {s.beats} beats · {s.pins} pinned · {s.sheets} sheets · {s.aspectRatio} · {s.resolution}
                </Text>
                <View style={styles.badges}>
                  {data?.selectedId === s.id ? <Badge variant="info" label="selected" /> : null}
                  <Badge variant={s.status === 'published' ? 'success' : 'muted'} label={s.status} />
                  {s.hasTargetAudio ? <Badge variant="outline" label="target audio" /> : null}
                </View>
              </View>
              <ChevronRight size={16} color={colors.subtleForeground} />
            </Card>
          </BouncyPressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  flex1: { flex: 1, gap: 4 },
  form: { gap: 10 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.input,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.muted,
  },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  meta: { fontSize: 12, color: theme.colors.mutedForeground },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
}));
