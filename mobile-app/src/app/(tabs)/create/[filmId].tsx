import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  RotateCw,
  Share2,
  X,
} from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Empty, Loading } from '@/components/ui/empty';
import { API_ORIGIN } from '@/lib/env';
import { useColors } from '@/lib/colors';
import {
  confirmFilm,
  filmProject,
  filmVideoUrl,
  flowOf,
  formatLength,
  getFilm,
  LIVE_STATUSES,
  retryFilm,
  shareFilm,
  stepsOf,
  type FilmJob,
  type StepRow,
} from '@/lib/film';
import { useProjectStore } from '@/lib/project';
import { useAdoptProject } from '@/lib/use-adopt-project';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import { useManualRefresh } from '@/lib/use-manual-refresh';

// One Film being made — the web's `/create/:filmId` on a phone. Every step of
// the pipeline as it completes (done / in progress / waiting), then the video
// and the way into the second layer: "Continue working on the video" hands the
// Film's own project to the Studio tab, with the studio agent on the pill.
//
// Polls every 5s while the Film is live (the web also listens to the SSE
// firehose; polling alone is enough here, and survives backgrounding).

const POLL_MS = 5000;

function StepIcon({ status }: { status: StepRow['status'] }) {
  const colors = useColors();
  if (status === 'done')
    return (
      <View style={[styles.dot, styles.dotDone]}>
        <Check size={12} color={colors.primaryForeground} />
      </View>
    );
  if (status === 'failed')
    return (
      <View style={[styles.dot, styles.dotFailed]}>
        <X size={12} color={colors.destructiveForeground} />
      </View>
    );
  if (status === 'running' || status === 'retrying')
    return (
      <View style={styles.dot}>
        <ActivityIndicator size="small" />
      </View>
    );
  return (
    <View style={styles.dot}>
      <Circle size={14} color={colors.subtleForeground} />
    </View>
  );
}

const STEP_WORD: Record<StepRow['status'], string> = {
  done: 'done',
  failed: 'failed',
  retrying: 'retrying',
  running: 'in progress',
  pending: 'waiting',
};

function FilmPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={styles.video} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />;
}

function headline(job: FilmJob): string {
  switch (job.status) {
    case 'done':
      return job.film?.title || 'Your story is ready';
    case 'queued':
      return `Queued${job.position ? ` — position ${job.position}` : ''}…`;
    case 'awaiting-confirm':
      return 'Waiting on you';
    case 'stopped':
      return "This story couldn't be finished";
    case 'declined':
      return 'This story was declined';
    case 'refused':
      return 'This story was refused';
    default:
      return 'Making your story…';
  }
}

export default function FilmScreen() {
  const { filmId } = useLocalSearchParams<{ filmId: string }>();
  const colors = useColors();
  const barInset = useTabBarScrollProps();
  const queryClient = useQueryClient();
  const adopt = useAdoptProject();
  const projectId = useProjectStore((s) => s.projectId);
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The Film's own project first — the rest of its routes, and its media, are
  // addressed to it. A Film from before the lookup existed 404s here, and the
  // current project is then the best guess (as on the web).
  const home = useQuery({
    queryKey: ['film', filmId, 'project'],
    queryFn: () => filmProject(filmId),
    enabled: !!filmId,
    retry: false,
    staleTime: Infinity,
  });
  const filmHome = home.data?.projectId;
  const adopted = useRef(false);
  useEffect(() => {
    if (filmHome && !adopted.current) {
      adopted.current = true;
      adopt(filmHome);
    }
  }, [filmHome, adopt]);

  const film = useQuery({
    queryKey: ['film', filmId],
    queryFn: () => getFilm(filmId),
    enabled: !!filmId && (home.isSuccess || home.isError),
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return !status || LIVE_STATUSES.has(status) ? POLL_MS : false;
    },
    retry: 1,
  });

  // Only a pull shows the spinner — the 5s poll refetches silently.
  const { refreshing, onRefresh } = useManualRefresh(film.refetch);
  const job = film.data?.job;
  const pid = film.data?.projectId || filmHome || projectId;

  // A haptic when the Film lands, the way a finished render reads on a phone.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastStatus.current && lastStatus.current !== 'done' && job?.status === 'done') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    lastStatus.current = job?.status;
  }, [job?.status]);

  const setJob = (next?: FilmJob) => {
    if (next) queryClient.setQueryData(['film', filmId], { job: next, projectId: pid });
    queryClient.invalidateQueries({ queryKey: ['film', filmId] });
    queryClient.invalidateQueries({ queryKey: ['account', 'films'] });
  };

  const retry = async () => {
    setBusy('retry');
    setNotice(null);
    try {
      const r = await retryFilm(filmId);
      if (r.ok) setJob(r.job);
      else setNotice(r.message || "Couldn't retry this story.");
    } catch (e: any) {
      setNotice(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const answer = async (yes: boolean) => {
    setBusy(yes ? 'confirm' : 'decline');
    try {
      const r = await confirmFilm(filmId, yes);
      setJob(r.job);
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy('share');
    try {
      const r = await shareFilm(filmId);
      if (!r.path) throw new Error("Couldn't make a share link");
      await Share.share({ url: API_ORIGIN + r.path, message: API_ORIGIN + r.path });
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  // The second layer: the Film's project is already the current one (adopted
  // above), so its studio is simply the Studio tab.
  const continueWorking = () => {
    adopt(pid);
    router.navigate('/(tabs)/studio');
  };

  if (!filmId) return <Empty title="There's no story here." />;
  if (film.isPending) return <Loading />;
  if (!job) {
    return (
      <View style={styles.centerWrap}>
        <Empty title="There's no story here." hint="It may have been made on another account." />
        <Button title="New story" onPress={() => router.back()} />
      </View>
    );
  }

  const steps = stepsOf(job);
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const video = job.status === 'done' ? filmVideoUrl(job, pid) : undefined;
  const flow = flowOf(job.engine);
  const details = [
    flow.label,
    job.film?.seconds || job.seconds ? formatLength(Math.round(job.film?.seconds || job.seconds || 0)) : null,
    job.resolution || '480p',
    typeof job.spent === 'number' ? `$${job.spent.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      {...barInset}
    >
      <Stack.Screen options={{ title: job.status === 'done' ? 'Your story' : 'Making your story' }} />

      <Pressable
        onPress={() => setPromptOpen((v) => !v)}
        style={styles.promptCard}
        accessibilityRole="button"
        accessibilityLabel={promptOpen ? 'Collapse the prompt' : 'Expand the prompt'}
      >
        <Text style={styles.prompt} numberOfLines={promptOpen ? undefined : 2}>
          {job.prompt}
        </Text>
        {promptOpen ? (
          <ChevronUp size={16} color={colors.subtleForeground} />
        ) : (
          <ChevronDown size={16} color={colors.subtleForeground} />
        )}
      </Pressable>

      <Text style={styles.headline}>{headline(job)}</Text>
      <Text style={styles.meta}>{details}</Text>

      {video ? (
        <View style={styles.doneBlock}>
          <FilmPlayer uri={video} />
          <Button title="Continue working on the video" size="lg" onPress={continueWorking} />
          <Button
            accessibilityLabel="Share"
            variant="outline"
            loading={busy === 'share'}
            onPress={share}
          >
            {busy === 'share' ? null : (
              <View style={styles.btnRow}>
                <Share2 size={15} color={colors.foreground} />
                <Text style={styles.btnText}>Share</Text>
              </View>
            )}
          </Button>
        </View>
      ) : null}

      {job.status === 'stopped' ? (
        <View style={styles.block}>
          <Text style={styles.body}>
            {notice ?? "It doesn't count against your allowance."}
            {job.stopped?.reason ? `\n${job.stopped.reason}` : ''}
          </Text>
          <Button
            title={`Retry from ${job.stopped?.label ?? 'the failed step'}`}
            loading={busy === 'retry'}
            onPress={retry}
          />
        </View>
      ) : null}

      {job.status === 'awaiting-confirm' ? (
        <View style={styles.block}>
          <Text style={styles.body}>{job.confirm?.summary || 'The script is ready. Make the film?'}</Text>
          <View style={styles.row}>
            <Button
              title="Make it"
              style={styles.flex1}
              loading={busy === 'confirm'}
              onPress={() => answer(true)}
            />
            <Button
              title="Not now"
              variant="outline"
              style={styles.flex1}
              loading={busy === 'decline'}
              onPress={() => answer(false)}
            />
          </View>
        </View>
      ) : null}

      {job.status === 'refused' && job.error ? <Text style={styles.body}>{job.error}</Text> : null}

      <View style={styles.stepsHead}>
        <Text style={styles.section}>Steps</Text>
        <Text style={styles.count}>
          {doneCount} / {steps.length}
        </Text>
      </View>
      <View style={styles.steps}>
        {steps.map((s, i) => (
          <View key={s.key} style={styles.step} accessibilityLabel={`${s.label}, ${STEP_WORD[s.status]}`}>
            <View style={styles.rail}>
              <StepIcon status={s.status} />
              {i < steps.length - 1 ? (
                <View style={[styles.line, s.status === 'done' && styles.lineDone]} />
              ) : null}
            </View>
            <View style={styles.stepText}>
              <View style={styles.stepTitleRow}>
                <Text style={[styles.stepTitle, s.status === 'pending' && styles.stepPending]}>{s.label}</Text>
                <Text style={[styles.stepWord, s.status === 'failed' && styles.failedWord]}>
                  {STEP_WORD[s.status]}
                </Text>
              </View>
              {s.line ? (
                <Text style={[styles.stepLine, s.status === 'failed' && styles.failedWord]} numberOfLines={4}>
                  {s.line}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {job.status !== 'done' && pid ? (
        <Pressable
          onPress={continueWorking}
          style={({ pressed }) => [styles.studioLink, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel="Open this story's studio"
        >
          <RotateCw size={14} color={colors.mutedForeground} />
          <Text style={styles.studioLinkText}>Open this story's studio while it's made</Text>
          <ArrowRight size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 40 },
  centerWrap: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: theme.colors.background },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  prompt: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.foreground },
  headline: { marginTop: 18, fontSize: 24, lineHeight: 30, fontWeight: '800', color: theme.colors.foreground },
  meta: { marginTop: 4, fontSize: 13, color: theme.colors.mutedForeground },
  doneBlock: { marginTop: 16, gap: 10 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 0, backgroundColor: '#000' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  block: { marginTop: 16, gap: 10 },
  body: { fontSize: 14, lineHeight: 20, color: theme.colors.mutedForeground },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  stepsHead: { marginTop: 28, marginBottom: 10, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  section: { fontSize: 18, fontWeight: '700', color: theme.colors.foreground },
  count: { fontSize: 13, color: theme.colors.mutedForeground, fontVariant: ['tabular-nums'] },
  steps: {},
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 24, alignItems: 'center' },
  dot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: theme.colors.primary },
  dotFailed: { backgroundColor: theme.colors.destructive },
  line: { flex: 1, width: 2, minHeight: 14, marginVertical: 2, borderRadius: 0, backgroundColor: theme.colors.border },
  lineDone: { backgroundColor: theme.colors.primary },
  stepText: { flex: 1, paddingBottom: 16, paddingTop: 2 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  stepTitle: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  stepPending: { color: theme.colors.subtleForeground, fontWeight: '500' },
  stepWord: { fontSize: 12, color: theme.colors.mutedForeground },
  failedWord: { color: theme.colors.destructive },
  stepLine: { marginTop: 2, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  studioLink: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  studioLinkText: { flex: 1, fontSize: 14, color: theme.colors.mutedForeground },
  pressed: { opacity: 0.6 },
}));
