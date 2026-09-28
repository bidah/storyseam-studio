import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CircleCheck, KeyRound, Share2, TriangleAlert } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { InlineVideo } from '@/components/studio/upscale-video';
import { ApiError, apiJson, mediaUrl, postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useFalKeyStore } from '@/lib/fal-key';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Upscale — a finished film taken to a higher resolution on fal (the mobile
// port of src/routes/upscale.jsx). Sources are kept Stage sittings (and their
// scored versions) and Editor renders; the original is never touched — the
// result is a new file beside it. Billed to the author's own fal key.

type Model = { id: string; label: string; blurb?: string; resolutions: string[] };
type Source = {
  id: string;
  origin: 'stage' | 'editor';
  label: string;
  detail?: string;
  url: string;
  seconds?: number;
  bytes?: number;
  at?: string | number;
};
type Job = {
  id: string;
  model: string;
  modelLabel?: string;
  resolution: string;
  source?: { id: string; label?: string };
  status: 'running' | 'done' | 'error';
  queuePosition?: number;
  url?: string;
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
};
type UpscalePayload = { models: Model[]; sources: Source[]; jobs: Job[] };

const POLL_MS = 5000;

const fmtBytes = (n?: number) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const fmtSecs = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

async function shareJob(job: Job) {
  const url = mediaUrl(job.url);
  if (!url) throw new Error('No file to share');
  const dest = new File(Paths.cache, job.file || `upscaled-${job.id}.mp4`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(url, dest);
  await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function JobRow({ job }: { job: Job }) {
  const colors = useColors();
  const [sharing, setSharing] = useState(false);
  const label = `${job.modelLabel || job.model} · ${job.resolution}`;
  if (job.status === 'done') {
    return (
      <View style={styles.job}>
        <View style={styles.jobHead}>
          <CircleCheck size={14} color={colors.success} />
          <Text style={styles.jobLabel} numberOfLines={1}>
            {label}
            {job.width && job.height ? ` · ${job.width}×${job.height}` : ''}
            {job.bytes ? ` · ${fmtBytes(job.bytes)}` : ''}
          </Text>
          <Button
            size="icon"
            variant="ghost"
            accessibilityLabel="Share the upscaled video"
            loading={sharing}
            onPress={async () => {
              setSharing(true);
              try {
                await shareJob(job);
              } catch (e: any) {
                toast.error(String(e?.message || 'Share failed'));
              } finally {
                setSharing(false);
              }
            }}
          >
            <Share2 size={16} color={colors.foreground} />
          </Button>
        </View>
        <InlineVideo url={job.url} />
      </View>
    );
  }
  if (job.status === 'error') {
    return (
      <View style={[styles.job, styles.jobError]}>
        <View style={styles.jobHead}>
          <TriangleAlert size={14} color={colors.destructive} />
          <Text style={styles.jobLabel}>
            {label} failed — <Text style={styles.muted}>{job.error}</Text>
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.job}>
      <View style={styles.jobHead}>
        <Badge label="Upscaling" variant="info" />
        <Text style={styles.jobLabel} numberOfLines={1}>
          {label}
          {job.queuePosition != null ? ` · queue ${job.queuePosition}` : ''}
        </Text>
      </View>
    </View>
  );
}

export default function UpscaleScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const falKey = useFalKeyStore((s) => s.key);
  const { data, isLoading, error, refetch } = useProjectResource<UpscalePayload>('upscale');
  const invalidate = useInvalidate();
  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const [modelId, setModelId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('1080p');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ message: string; noKey: boolean } | null>(null);

  useEffect(() => setJobs(data?.jobs ?? []), [data?.jobs]);

  const models = data?.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models[0];
  // A model that doesn't offer the current resolution falls back to its first.
  useEffect(() => {
    if (model && !model.resolutions.includes(resolution)) setResolution(model.resolutions[0]);
  }, [model, resolution]);

  const sources = data?.sources ?? [];
  const source = sources.find((s) => s.id === sourceId) ?? null;

  // Chained, not an interval: the poll that finds a job finished also copies a
  // possibly-4K file into the bucket, and the next tick must wait for it.
  const running = jobs.filter((j) => j.status === 'running').map((j) => j.id).join(',');
  useEffect(() => {
    if (!running) return undefined;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const updates = await Promise.all(
        running.split(',').map((id) =>
          apiJson<{ job: Job }>(`/api/upscale/jobs/${encodeURIComponent(id)}`).catch(() => null),
        ),
      );
      if (stop) return;
      const byId = new Map(updates.filter((u): u is { job: Job } => !!u?.job).map((u) => [u.job.id, u.job]));
      setJobs((prev) => prev.map((j) => byId.get(j.id) ?? j));
      if ([...byId.values()].some((j) => j.status !== 'running')) {
        invalidate('upscale');
        return; // `running` changes, which restarts this effect for the rest
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, invalidate]);

  const onHeight = useCallback(
    (h: number) => {
      if (!sourceId) return;
      setHeights((m) => (m[sourceId] === h ? m : { ...m, [sourceId]: h }));
    },
    [sourceId],
  );

  const upscale = async () => {
    if (!source || !model) return;
    setStartError(null);
    setStarting(true);
    try {
      const { job } = await postJson<{ job: Job }>('/api/upscale', {
        source: source.id,
        model: model.id,
        resolution,
        ...(heights[source.id] ? { sourceHeight: heights[source.id] } : {}),
      });
      setJobs((prev) => [job, ...prev]);
    } catch (e: any) {
      setStartError({
        message: String(e?.message || e),
        noKey: e instanceof ApiError && e.status === 401,
      });
    } finally {
      setStarting(false);
    }
  };

  const jobsBySource = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of jobs) {
      const id = j.source?.id ?? '';
      m.set(id, [...(m.get(id) ?? []), j]);
    }
    return m;
  }, [jobs]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote message={String((error as Error).message)} onRetry={refetch} />;

  const keyNote = (
    <Pressable onPress={() => router.push('/settings')} accessibilityRole="link" style={styles.keyNote}>
      <KeyRound size={14} color={colors.mutedForeground} />
      <Text style={styles.keyNoteText}>
        An upscale is billed to your own fal key — <Text style={styles.link}>add it in Settings</Text>.
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      {...barInset}
    >
      <Text style={styles.intro}>
        Take a finished film — a kept sitting or an Editor render — to a higher resolution. The
        original stays; the upscale is a new file beside it.
      </Text>

      <Eyebrow style={styles.mt}>Model</Eyebrow>
      <View style={styles.chips}>
        {models.map((m) => (
          <Chip key={m.id} label={m.label} active={m.id === model?.id} onPress={() => setModelId(m.id)} />
        ))}
      </View>
      {model?.blurb ? <Text style={styles.blurb}>{model.blurb}</Text> : null}

      <Eyebrow style={styles.mt}>Resolution</Eyebrow>
      <View style={styles.chips}>
        {(model?.resolutions ?? []).map((r) => (
          <Chip key={r} label={r === '2160p' ? '2160p (4K)' : r} active={r === resolution} onPress={() => setResolution(r)} />
        ))}
      </View>

      {!falKey ? keyNote : null}

      <Eyebrow style={styles.mt}>Source</Eyebrow>
      {sources.length === 0 ? (
        <Empty title="Nothing finished yet" hint="Keep a sitting on the Stage or render in the Editor, then upscale it here." />
      ) : (
        <View style={styles.list}>
          {sources.map((s) => {
            const selected = s.id === sourceId;
            const sJobs = jobsBySource.get(s.id) ?? [];
            return (
              <Card key={s.id} style={[styles.source, selected && styles.sourceActive]}>
                <Pressable
                  onPress={() => setSourceId(selected ? null : s.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={s.label}
                  style={styles.sourceHead}
                >
                  <View style={styles.flex1}>
                    <Text style={styles.sourceTitle} numberOfLines={1}>
                      {s.label}
                    </Text>
                    <Text style={styles.muted}>
                      {[s.origin === 'stage' ? 'Stage' : 'Editor', s.detail, fmtSecs(s.seconds), fmtBytes(s.bytes), heights[s.id] ? `${heights[s.id]}p` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  {sJobs.length ? <Badge label={`${sJobs.length}`} variant="muted" /> : null}
                </Pressable>
                {selected ? (
                  <View style={styles.selected}>
                    <InlineVideo url={s.url} onHeight={onHeight} />
                    <Button
                      title={`Upscale to ${resolution}`}
                      loading={starting}
                      disabled={!model}
                      onPress={upscale}
                    />
                    {startError ? (
                      startError.noKey ? (
                        keyNote
                      ) : (
                        <Text style={styles.error}>{startError.message}</Text>
                      )
                    ) : null}
                  </View>
                ) : null}
                {sJobs.map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 32 },
  flex1: { flex: 1 },
  mt: { marginTop: 18 },
  intro: { fontSize: 14, lineHeight: 20, color: theme.colors.mutedForeground },
  blurb: { marginTop: 6, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  chipTextActive: { color: theme.colors.primaryForeground },
  keyNote: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  keyNoteText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  link: { color: theme.colors.primary, textDecorationLine: 'underline' },
  list: { gap: 10 },
  source: { padding: 12, gap: 10 },
  sourceActive: { borderColor: theme.colors.primary },
  sourceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  selected: { gap: 10 },
  muted: { fontSize: 12, color: theme.colors.mutedForeground },
  error: { fontSize: 13, color: theme.colors.destructive },
  job: {
    gap: 8,
    padding: 10,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.muted,
  },
  jobError: { borderColor: theme.colors.destructive },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobLabel: { flex: 1, fontSize: 13, color: theme.colors.foreground },
}));
