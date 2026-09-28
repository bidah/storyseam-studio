import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Check, Monitor, Sparkles } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { Segmented } from '@/components/ui/segmented';
import { StageVideo } from '@/components/studio/stage-video';
import { apiJson, postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { mmss, useShotSheet, type DirectorIndex, type Take } from '@/lib/director';
import { useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Shot sheet — the whole cue sheet's pins drawn as clips, then cut back into
// pinned frames. On a phone: pick a Series, choose which frames to draw, preview
// the plan for free, render (it bills the author's fal key — confirmed first),
// and watch the takes land. CUTTING a take into frames decodes the video on a
// canvas, which is the browser's job (agent-parity.txt) — that stays on the web.

type Duration = '5' | '10' | '15';
type Preview = { plan?: { clips?: unknown[]; refused?: unknown }; errors?: { message?: string }[] };

function takeLabel(t: Take) {
  const part = t.parts && t.parts > 1 ? `Clip ${(t.part ?? 0) + 1} of ${t.parts}` : 'Clip';
  return t.opensAt != null ? `${part} · opens ${mmss(t.opensAt)}` : part;
}

export default function ShotSheetScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const index = useProjectResource<DirectorIndex>('director');
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const activeId = seriesId ?? index.data?.selectedId ?? index.data?.series?.[0]?.id ?? null;
  const sheet = useShotSheet(activeId);
  const { refreshing, onRefresh } = useManualRefresh(index.refetch, sheet.refetch);

  const [chosen, setChosen] = useState<number[] | null>(null);
  const [duration, setDuration] = useState<Duration>('15');
  const [busy, setBusy] = useState(false);

  // A fresh sheet chooses every frame that isn't refused, as the web does.
  const slots = sheet.data?.slots ?? [];
  useEffect(() => {
    setChosen(null);
  }, [activeId]);
  const picked = useMemo(
    () => chosen ?? slots.filter((s) => !s.refused).map((s) => s.offset),
    [chosen, slots],
  );
  const toggle = (offset: number) =>
    setChosen((prev) => {
      const cur = prev ?? picked;
      return cur.includes(offset) ? cur.filter((o) => o !== offset) : [...cur, offset].sort((a, b) => a - b);
    });

  // Poll the running takes; each call also advances the render on the Worker.
  const takes = sheet.data?.takes ?? [];
  const runningIds = takes.filter((t) => t.status === 'running').map((t) => t.id).join(',');
  const refetchSheet = sheet.refetch;
  useEffect(() => {
    if (!runningIds) return;
    const ids = runningIds.split(',');
    const timer = setInterval(async () => {
      let settled = false;
      await Promise.all(
        ids.map(async (id) => {
          try {
            const next = await apiJson<Take>(`/api/shotsheet/take/${encodeURIComponent(id)}`);
            if (next.status !== 'running') settled = true;
          } catch {
            /* a transient failure is not a finished render */
          }
        }),
      );
      if (settled) refetchSheet();
    }, 5000);
    return () => clearInterval(timer);
  }, [runningIds, refetchSheet]);

  const base = `/api/shotsheet/${encodeURIComponent(activeId || '')}`;
  const body = { slots: picked, duration: Number(duration) };

  const render = async () => {
    setBusy(true);
    try {
      // The preview is free and runs the Worker's own planner — so the confirm
      // can say how many clips will bill, and a refused plan never spends.
      const preview = await postJson<Preview>(`${base}/preview`, body);
      const errors = (preview.errors ?? []).map((e) => e.message || String(e)).filter(Boolean);
      if (errors.length || preview.plan?.refused) {
        toast.error(errors[0] || 'The Director would refuse this sheet.');
        return;
      }
      const clips = preview.plan?.clips?.length ?? 1;
      Alert.alert(
        `Render ${clips} clip${clips === 1 ? '' : 's'}?`,
        'This bills your fal.ai key. Each clip is its own take.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Render',
            onPress: async () => {
              try {
                const started = await postJson<{ error?: string }>(`${base}/render`, body);
                if (started?.error) toast.error(started.error);
                else toast.success('Rendering — takes land below');
                refetchSheet();
              } catch (e: any) {
                toast.error(String(e?.message || e));
              }
            },
          },
        ],
      );
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (index.isLoading && !index.data) return <Loading />;
  if (index.error && !index.data) {
    return <ErrorNote message={String((index.error as any)?.message || index.error)} onRetry={() => index.refetch()} />;
  }
  const series = index.data?.series ?? [];
  if (!series.length) {
    return <Empty title="No Series yet" hint="Make a Series in Director first — the Shot sheet draws its cue sheet." />;
  }

  return (
    <ScrollView
      {...barInset}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {series.map((s) => {
          const on = s.id === activeId;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Series ${s.title}`}
              onPress={() => setSeriesId(s.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {s.title || 'Untitled'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {sheet.isLoading && !sheet.data ? (
        <Loading />
      ) : sheet.error && !sheet.data ? (
        <ErrorNote message={String((sheet.error as any)?.message || sheet.error)} onRetry={() => sheet.refetch()} />
      ) : (
        <>
          <Eyebrow style={styles.mt}>Frames · {picked.length} of {slots.length} chosen</Eyebrow>
          {slots.length === 0 ? (
            <Text style={styles.muted}>This Series has no cue sheet yet — derive one in Director.</Text>
          ) : (
            slots.map((slot) => {
              const on = picked.includes(slot.offset);
              const refused = !!slot.refused;
              return (
                <Pressable
                  key={slot.offset}
                  disabled={refused}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: refused }}
                  accessibilityLabel={`Frame at ${mmss(slot.offset)}`}
                  onPress={() => toggle(slot.offset)}
                >
                  <Card style={[styles.slot, refused && styles.dim]}>
                    <View style={[styles.box, on && !refused && styles.boxOn]}>
                      {on && !refused ? <Check size={12} color={colors.primaryForeground} /> : null}
                    </View>
                    <View style={styles.flex1}>
                      <View style={styles.rowCenter}>
                        <Text style={styles.offset}>{mmss(slot.offset)}</Text>
                        <Badge variant="outline" label={slot.kind} />
                        {slot.filled ? <Badge variant="success" label="pinned" /> : null}
                        {refused ? <Badge variant="warning" label="refused" /> : null}
                      </View>
                      {slot.brief ? (
                        <Text style={styles.brief} numberOfLines={3}>
                          {slot.brief}
                        </Text>
                      ) : null}
                      {typeof slot.refused === 'string' ? <Text style={styles.warn}>{slot.refused}</Text> : null}
                    </View>
                  </Card>
                </Pressable>
              );
            })
          )}

          {slots.length > 0 ? (
            <Card style={styles.gap10}>
              <Text style={styles.label}>Clip length (seconds)</Text>
              <Segmented<Duration>
                options={[
                  { value: '5', label: '5s' },
                  { value: '10', label: '10s' },
                  { value: '15', label: '15s' },
                ]}
                value={duration}
                onChange={setDuration}
              />
              <Button title="Render — costs money" loading={busy} disabled={!picked.length} onPress={render}>
                {busy ? null : <Sparkles size={15} color={colors.primaryForeground} />}
              </Button>
            </Card>
          ) : null}

          <Eyebrow style={styles.mt}>Takes · {takes.length}</Eyebrow>
          <Card style={styles.note}>
            <Monitor size={16} color={colors.primary} />
            <Text style={styles.noteText}>Cutting a take into pinned frames runs in the web studio.</Text>
          </Card>
          {takes.length === 0 ? (
            <Text style={styles.muted}>No takes yet.</Text>
          ) : (
            takes.map((t) => (
              <Card key={t.id} style={styles.gap10}>
                <View style={styles.rowCenter}>
                  <Text style={[styles.flex1, styles.takeTitle]}>{takeLabel(t)}</Text>
                  <Badge
                    variant={t.status === 'done' ? 'success' : t.status === 'error' ? 'destructive' : 'info'}
                    label={t.status === 'running' ? 'rendering' : t.status}
                  />
                </View>
                {t.status === 'error' && t.error ? <Text style={styles.warn}>{t.error}</Text> : null}
                {t.status === 'done' && t.url ? <StageVideo url={t.url} /> : null}
              </Card>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  chips: { gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    maxWidth: 220,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.foreground },
  chipTextOn: { color: theme.colors.primaryForeground },
  mt: { marginTop: 8, marginBottom: 0 },
  muted: { fontSize: 13, color: theme.colors.mutedForeground },
  slot: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'flex-start' },
  dim: { opacity: 0.55 },
  box: {
    marginTop: 2,
    width: 20,
    height: 20,
    borderRadius: 0,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  flex1: { flex: 1, gap: 4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  offset: { fontSize: 13, fontWeight: '600', color: theme.colors.primary, fontVariant: ['tabular-nums'] },
  brief: { fontSize: 13, lineHeight: 18, color: theme.colors.foreground },
  warn: { fontSize: 12, color: theme.colors.warning },
  gap10: { gap: 10 },
  label: { fontSize: 13, color: theme.colors.mutedForeground },
  takeTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.foreground },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
}));
