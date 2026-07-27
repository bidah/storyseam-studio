import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toast } from 'sonner-native';
import {
  Check,
  Image as ImageIcon,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Speech,
  Volume2,
  Wand2,
  X,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { mediaUrl, postJson, toPreviewSrc } from '@/lib/api';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import {
  renderEpisodeMessage,
  renderStoryboardAllMessage,
  renderStoryboardMessage,
  trimMessage,
} from '@/lib/agent/messages';
import { createPickerRequest } from '@/lib/picker-bus';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { cn } from '@/lib/utils';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import {
  RESTRICTIONS,
  SIGN_SECTIONS,
  composeAudioBlock,
  composeRefBlock,
  lineFromRestrictions,
  parsePrompt,
  refLabel,
  restrictionsFromLine,
  serializePrompt,
  shotDialogue,
  signedCount,
  type AudioPayload,
  type AudioRef,
  type EpisodePayload,
  type FinalPayload,
  type PromptSections,
  type Shot,
  type Signoff,
  type StillTake,
  type StoryboardPayload,
  type VideoTake,
} from '@/components/episode/prompt';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const SIGNER_KEY = 'shotStudioSigner';

// ---------------------------------------------------------------------------
// Small local pieces

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        'flex-row items-center gap-1 rounded-full border px-3 py-1.5 active:opacity-70',
        on ? 'border-primary bg-primary/15' : 'border-border bg-transparent',
      )}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
    >
      {on ? <Check size={12} color={colors.primary} /> : null}
      <Text className={cn('text-[12px] font-medium', on ? 'text-primary' : 'text-muted-foreground')}>
        {label}
      </Text>
    </Pressable>
  );
}

function SelectDot({ selected, onPress }: { selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={selected ? 'Unselect' : 'Select'}
      className={cn(
        'absolute left-2 top-2 h-7 w-7 items-center justify-center rounded-full border-2 border-white/80',
        selected ? 'bg-primary' : 'bg-black/50',
      )}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
    >
      <Check size={15} color={selected ? colors.primaryForeground : 'transparent'} />
    </Pressable>
  );
}

// One rendered take card — inline expo-video preview (paused first frame) with
// expand-to-viewer, select radio, TRIM badge, and a Trim action on the
// selected take.
function TakeCard({
  take,
  bundleId,
  onToggleSelect,
  onOpenTrim,
}: {
  take: VideoTake;
  bundleId: string;
  onToggleSelect: (take: VideoTake, selected: boolean) => void;
  onOpenTrim: (take: VideoTake, duration: number) => void;
}) {
  const src = mediaUrl(toPreviewSrc(take.url)) as string;
  const player = useVideoPlayer(src);
  const colors = useColors();
  return (
    <View
      className={cn(
        'w-[280px] rounded-xl border bg-card p-2',
        take.selected ? 'border-primary' : 'border-border',
      )}
    >
      <View className="overflow-hidden rounded-lg bg-black">
        <VideoView
          player={player}
          style={{ width: 262, height: 148 }}
          contentFit="cover"
          nativeControls={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play take"
          className="absolute inset-0 items-center justify-center"
          onPress={() =>
            router.push({
              pathname: '/viewer',
              params: { url: src, kind: 'video', title: `${bundleId} · ${take.name || take.file}` },
            })
          }
        >
          <View className="h-11 w-11 items-center justify-center rounded-full bg-black/50">
            <Play size={20} color={colors.primaryForeground} />
          </View>
        </Pressable>
        <SelectDot selected={!!take.selected} onPress={() => onToggleSelect(take, !take.selected)} />
        {take.kind === 'trim' ? (
          <View className="absolute right-2 top-2">
            <Badge label="Trim" variant="warning">
              <Scissors size={10} color={colors.amber} />
            </Badge>
          </View>
        ) : null}
      </View>
      <View className="mt-2 flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-[12px] text-muted-foreground" numberOfLines={1}>
          {take.name || take.file}
        </Text>
        {take.selected ? (
          <Button
            size="sm"
            variant="outline"
            title="Trim"
            onPress={() => onOpenTrim(take, player.duration || 0)}
          >
            <Scissors size={13} color={colors.foreground} />
          </Button>
        ) : null}
      </View>
    </View>
  );
}

// One still take thumb inside a shot's horizontal strip.
function StillThumb({
  still,
  onToggle,
  onView,
}: {
  still: StillTake;
  onToggle: (still: StillTake, selected: boolean) => void;
  onView: (still: StillTake) => void;
}) {
  return (
    <View
      className={cn(
        'overflow-hidden rounded-lg border',
        still.selected ? 'border-primary' : 'border-border',
      )}
    >
      <Pressable accessibilityRole="button" onPress={() => onView(still)}>
        <Image
          source={{ uri: mediaUrl(still.url) }}
          style={{ width: 150, height: 84 }}
          contentFit="cover"
        />
      </Pressable>
      <SelectDot selected={!!still.selected} onPress={() => onToggle(still, !still.selected)} />
      {still.angle ? (
        <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
          <Text className="text-[10px] text-white/90" numberOfLines={1}>
            {still.angle}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail screen

export default function BundleDetail() {
  const barInset = useTabBarScrollProps();
  const params = useLocalSearchParams<{ bundleId: string }>();
  const id = String(params.bundleId ?? '');
  const { width } = useWindowDimensions();
  const colors = useColors();
  const scheme = useEffectiveScheme();
  const invalidate = useInvalidate();
  const agent = useAgent();
  const agentBusy = agentIsBusy(agent);

  const ep = useProjectResource<EpisodePayload>('episode');
  const fn = useProjectResource<FinalPayload>('final');
  const au = useProjectResource<AudioPayload>('audio');
  const sb = useProjectResource<StoryboardPayload>('storyboard');

  const bundle = useMemo(
    () => ep.data?.episode?.bundles.find((b) => b.id === id),
    [ep.data, id],
  );

  // --- local mirrors of the server state (optimistic writes, query reconciles)
  const [mode, setMode] = useState<'stills' | 'video'>('stills');
  const [picks, setPicks] = useState<string[]>([]);
  const [audioPicks, setAudioPicks] = useState<string[]>([]);
  const [vids, setVids] = useState<VideoTake[]>([]);
  const [stills, setStills] = useState<Record<string, StillTake[]>>({});
  const [signoff, setSignoff] = useState<Signoff | null>(null);
  const [override, setOverride] = useState<string | undefined>(undefined);
  const [sec, setSec] = useState<PromptSections | null>(null);
  const [signer, setSigner] = useState('');
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [trim, setTrim] = useState<{ take: VideoTake; dur: number } | null>(null);
  const [trimFrom, setTrimFrom] = useState('0');
  const [trimTo, setTrimTo] = useState('');

  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverPicks = fn.data?.episode?.[id];
  useEffect(() => setPicks(serverPicks ?? []), [serverPicks]);
  const serverAudioPicks = au.data?.episode?.[id];
  useEffect(() => setAudioPicks(serverAudioPicks ?? []), [serverAudioPicks]);
  const serverVids = ep.data?.video?.[id];
  useEffect(() => setVids(serverVids ?? []), [serverVids]);
  const serverStills = sb.data?.stills?.[id];
  useEffect(() => setStills(serverStills ?? {}), [serverStills]);
  const serverSignoff = ep.data?.signoffs?.[id];
  useEffect(() => setSignoff(serverSignoff ?? null), [serverSignoff]);

  // Prompt sections + default mode initialize once from the first payload
  // (further server prompt changes are ignored while this screen is open so a
  // background refetch can't clobber in-progress edits).
  const inited = useRef(false);
  useEffect(() => {
    if (inited.current || !bundle || !ep.data) return;
    inited.current = true;
    const ov = ep.data.prompts?.[id];
    const body = typeof ov === 'string' ? ov : bundle.skillPrompt ?? '';
    setOverride(typeof ov === 'string' ? ov : undefined);
    setSec(parsePrompt(body));
    setMode((ep.data.video?.[id]?.length ?? 0) > 0 ? 'video' : 'stills');
  }, [bundle, ep.data, id]);

  useEffect(() => {
    AsyncStorage.getItem(SIGNER_KEY).then((v) => {
      if (v) setSigner(v);
    });
  }, []);

  useEffect(
    () => () => {
      if (promptTimer.current) clearTimeout(promptTimer.current);
    },
    [],
  );

  // --- derived
  const audioRefs = au.data?.audio ?? [];
  const audioMap = useMemo(() => {
    const m = new Map<string, AudioRef>();
    for (const a of audioRefs) m.set(a.rel, a);
    return m;
  }, [audioRefs]);
  const audioAssigned = useMemo(
    () => audioPicks.map((rel) => audioMap.get(rel)).filter((a): a is AudioRef => !!a),
    [audioPicks, audioMap],
  );

  const refBlock = useMemo(() => composeRefBlock(picks), [picks]);
  const audioBlock = useMemo(() => composeAudioBlock(audioAssigned), [audioAssigned]);
  const bodyPrompt = override ?? bundle?.skillPrompt ?? '';
  const displayPrompt = refBlock + audioBlock + '\n\n' + bodyPrompt;
  const edited = typeof override === 'string';
  const restr = useMemo(
    () => restrictionsFromLine(sec?.restrictionLine ?? ''),
    [sec?.restrictionLine],
  );
  const fullySigned = signedCount(signoff) === 3;

  // 3-up grid cell for the image-ref thumbs (screen padding 16, gaps 8).
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  // --- mutations (bodies verified against worker/src/routes/episode.js) -----

  const setPick = useCallback(
    (rel: string, selected: boolean) => {
      setPicks((prev) => {
        const s = new Set(prev);
        if (selected) s.add(rel);
        else s.delete(rel);
        return [...s];
      });
      postJson('/api/episode/select', { bundle: id, rel, selected })
        .then(() => invalidate('final'))
        .catch((e) => toast.error(String(e?.message || e)));
    },
    [id, invalidate],
  );

  const addRefs = useCallback(async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/library-picker', params: { requestId, mode: 'multi' } });
    const rels = (await promise) as string[] | null;
    if (!rels || rels.length === 0) return;
    for (const rel of rels) {
      if (!picks.includes(rel)) setPick(rel, true);
    }
  }, [picks, setPick]);

  const removeRef = useCallback(
    (rel: string) => {
      Alert.alert(
        'Remove reference?',
        `"${refLabel(rel)}" will no longer be used to generate ${id}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => setPick(rel, false) },
        ],
      );
    },
    [id, setPick],
  );

  const autoAssign = useCallback(() => {
    Alert.alert(
      'Auto-assign references',
      'Matches your library selections to every bundle by character + location. Replaces the existing picks for all bundles.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Auto-assign',
          onPress: async () => {
            setAutoAssigning(true);
            try {
              await postJson('/api/episode/auto-assign');
              invalidate('final', 'audio');
            } catch (e: any) {
              toast.error(String(e?.message || e));
            } finally {
              setAutoAssigning(false);
            }
          },
        },
      ],
    );
  }, [invalidate]);

  const toggleAudio = useCallback(
    (rel: string, selected: boolean) => {
      setAudioPicks((prev) => {
        const s = new Set(prev);
        if (selected) s.add(rel);
        else s.delete(rel);
        return [...s];
      });
      postJson('/api/episode/audio-select', { bundle: id, rel, selected })
        .then(() => invalidate('audio'))
        .catch((e) => toast.error(String(e?.message || e)));
    },
    [id, invalidate],
  );

  const pushSec = useCallback(
    (next: PromptSections) => {
      setSec(next);
      const text = serializePrompt(next);
      setOverride(text);
      if (promptTimer.current) clearTimeout(promptTimer.current);
      promptTimer.current = setTimeout(() => {
        postJson('/api/episode/prompt', { bundle: id, text }).catch((e) =>
          toast.error(String(e?.message || e)),
        );
      }, 700);
    },
    [id],
  );

  const resetPrompt = useCallback(() => {
    if (promptTimer.current) clearTimeout(promptTimer.current);
    setOverride(undefined);
    setSec(parsePrompt(bundle?.skillPrompt ?? ''));
    postJson('/api/episode/prompt', { bundle: id, text: '' })
      .then(() => invalidate('episode'))
      .catch((e) => toast.error(String(e?.message || e)));
  }, [bundle?.skillPrompt, id, invalidate]);

  const onSign = useCallback(
    async (section: 'images' | 'prompt' | 'audio', signed: boolean) => {
      const name = signer.trim();
      if (signed && !name) {
        toast.error('Enter your name in "Signed by" first');
        return;
      }
      try {
        const out = await postJson<{ signoff: Signoff }>('/api/episode/sign', {
          bundle: id,
          section,
          signed,
          signedBy: name,
        });
        setSignoff(out.signoff);
        if (signed) {
          AsyncStorage.setItem(SIGNER_KEY, name).catch(() => {});
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        invalidate('episode');
      } catch (e: any) {
        toast.error(String(e?.message || e));
      }
    },
    [id, signer, invalidate],
  );

  const toggleVideo = useCallback(
    (take: VideoTake, selected: boolean) => {
      // Only one take per bundle can be selected — picking one clears the rest.
      setVids((prev) =>
        prev.map((g) =>
          g.file === take.file ? { ...g, selected } : selected ? { ...g, selected: false } : g,
        ),
      );
      postJson('/api/episode/video-select', { bundle: id, file: take.file, selected })
        .then(() => invalidate('episode'))
        .catch((e) => toast.error(String(e?.message || e)));
    },
    [id, invalidate],
  );

  const toggleStill = useCallback(
    (shotId: string, still: StillTake, selected: boolean) => {
      setStills((all) => {
        const arr = (all[shotId] ?? []).map((g) =>
          g.file === still.file ? { ...g, selected } : selected ? { ...g, selected: false } : g,
        );
        return { ...all, [shotId]: arr };
      });
      postJson('/api/storyboard/select', { bundle: id, shot: shotId, file: still.file, selected })
        .then(() => invalidate('storyboard'))
        .catch((e) => toast.error(String(e?.message || e)));
    },
    [id, invalidate],
  );

  // --- agent sends -----------------------------------------------------------

  const send = useSendToAgent();
  const sendToAgent = useCallback(
    async (message: string) => {
      try {
        await send(message);
        toast.success('Sent to agent — watch the Chat tab');
      } catch (e: any) {
        toast.error(String(e?.message || e));
      }
    },
    [send],
  );

  const requestRender = useCallback(() => {
    if (!bundle) return;
    sendToAgent(renderEpisodeMessage(bundle, displayPrompt));
  }, [bundle, displayPrompt, sendToAgent]);

  const requestStill = useCallback(
    (shot: Shot, angle?: string) => {
      if (!bundle) return;
      sendToAgent(renderStoryboardMessage(bundle, shot, refBlock, angle));
    },
    [bundle, refBlock, sendToAgent],
  );

  const requestNewAngle = useCallback(
    (shot: Shot) => {
      if (Platform.OS === 'ios') {
        Alert.prompt(
          'New angle',
          'Describe the camera angle / variation for this take',
          (text) => requestStill(shot, text?.trim() || undefined),
        );
      } else {
        requestStill(shot);
      }
    },
    [requestStill],
  );

  const requestAllStills = useCallback(() => {
    if (!bundle) return;
    sendToAgent(renderStoryboardAllMessage(bundle, refBlock));
  }, [bundle, refBlock, sendToAgent]);

  const openTrim = useCallback((take: VideoTake, dur: number) => {
    setTrim({ take, dur });
    setTrimFrom('0');
    setTrimTo(dur > 0 ? dur.toFixed(2) : '');
  }, []);

  const trimFromN = parseFloat(trimFrom);
  const trimToN = parseFloat(trimTo);
  const trimValid =
    Number.isFinite(trimFromN) &&
    Number.isFinite(trimToN) &&
    trimFromN >= 0 &&
    trimToN > trimFromN + 0.09 &&
    (!trim || trim.dur <= 0 || trimToN <= trim.dur + 0.01);

  const createTrim = useCallback(() => {
    if (!trim || !trimValid) return;
    sendToAgent(trimMessage(id, trim.take.file, trimFromN, trimToN, trim.take.name));
    setTrim(null);
  }, [trim, trimValid, id, trimFromN, trimToN, sendToAgent]);

  // --- refresh ----------------------------------------------------------------

  const { refreshing, onRefresh } = useManualRefresh(
    ep.refetch,
    fn.refetch,
    au.refetch,
    sb.refetch,
  );

  // --- render -------------------------------------------------------------------

  // Native header title = the beat title (falls back to the bundle id while the
  // payload is still loading). The native back button + styling come from the
  // Stack screen options in the episode _layout.
  const screen = <Stack.Screen options={{ title: bundle?.beatTitle || bundle?.beat || '' }} />;

  // The Stills/Video toggle sits just under the native header as a sub-nav (same
  // pattern as the Assets/Story tabs), rendered only once the bundle is loaded.
  const subNav = bundle ? (
    <View className="px-4 pt-3">
      <SegmentedNative
        options={[
          { value: 'stills', label: 'Stills' },
          { value: 'video', label: 'Video' },
        ]}
        value={mode}
        onChange={setMode}
      />
    </View>
  ) : null;

  if (ep.isPending || (!bundle && (fn.isPending || au.isPending))) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <Loading />
      </View>
    );
  }
  if (ep.isError) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <ErrorNote message={(ep.error as Error)?.message || 'Failed to load'} onRetry={onRefresh} />
      </View>
    );
  }
  if (!bundle) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <Empty title="Bundle not found" hint={`No bundle "${id}" in the episode plan.`} />
      </View>
    );
  }

  const assignedThumbs = picks.map((rel) => ({
    rel,
    thumb: '/thumb/' + rel,
    url: '/asset/' + rel,
    name: rel.split('/').pop() || rel,
  }));

  return (
    <View className="flex-1 bg-background">
      {screen}
      {subNav}
      <ScrollView
        {...barInset}
        contentContainerClassName="px-4 pb-28 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* meta line */}
        <Text className="mb-4 text-[12px] text-muted-foreground">
          {bundle.shots.length} shots · ~{bundle.durationEst ?? '?'}s → {bundle.duration ?? '?'}s
          {bundle.images?.length
            ? `\nscene needs: ${bundle.images.map((im) => im.key).join(' · ')}`
            : ''}
        </Text>

        {mode === 'stills' ? (
          /* ------------------------------ STILLS ------------------------------ */
          <View className="gap-4">
            <Button
              title="Render all stills"
              disabled={agentBusy}
              onPress={requestAllStills}
            >
              <ImageIcon size={15} color={colors.primaryForeground} />
            </Button>

            {bundle.shots.map((s) => {
              const shotStills = stills[s.id] ?? [];
              const dlg = shotDialogue(s);
              return (
                <View key={s.id} className="rounded-2xl border border-border bg-card p-3">
                  <View className="mb-1 flex-row flex-wrap items-center gap-2">
                    <Badge label={s.id} variant="outline" />
                    <Text className="text-[12px] text-muted-foreground">
                      {s.dur ? `${s.dur}s · ` : ''}
                      {s.location || ''}
                      {s.camera ? ` · ${s.camera}` : ''}
                    </Text>
                    {shotStills.length > 0 ? (
                      <Badge label={`${shotStills.length}`} variant="success">
                        <ImageIcon size={10} color={colors.primary} />
                      </Badge>
                    ) : null}
                  </View>
                  <Text className="text-[14px] text-foreground">{s.summary || ''}</Text>
                  {dlg ? (
                    <View className="mt-1 flex-row items-start gap-1.5">
                      <Speech size={13} color={colors.subtleForeground} style={{ marginTop: 2 }} />
                      <Text className="flex-1 text-[12px] text-muted-foreground">{dlg}</Text>
                    </View>
                  ) : null}

                  {shotStills.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
                      <View className="flex-row gap-2">
                        {shotStills.map((st) => (
                          <StillThumb
                            key={st.file}
                            still={st}
                            onToggle={(still, selected) => toggleStill(s.id, still, selected)}
                            onView={(still) =>
                              router.push({
                                pathname: '/viewer',
                                params: {
                                  url: mediaUrl(still.url) as string,
                                  kind: 'image',
                                  title: `${id} · ${s.id}${still.angle ? ` · ${still.angle}` : ''}`,
                                },
                              })
                            }
                          />
                        ))}
                      </View>
                    </ScrollView>
                  ) : null}

                  <View className="mt-3 flex-row gap-2">
                    <Button
                      size="sm"
                      variant={shotStills.length ? 'outline' : 'default'}
                      title="Render still"
                      disabled={agentBusy}
                      onPress={() => requestStill(s)}
                    >
                      <ImageIcon size={13} color={shotStills.length ? colors.foreground : colors.primaryForeground} />
                    </Button>
                    {shotStills.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        title="New angle"
                        disabled={agentBusy}
                        onPress={() => requestNewAngle(s)}
                      >
                        <RotateCcw size={13} color={colors.foreground} />
                      </Button>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          /* ------------------------------ VIDEO ------------------------------- */
          <View className="gap-6">
            {/* takes carousel */}
            {vids.length > 0 ? (
              <View>
                <Eyebrow>Takes ({vids.length})</Eyebrow>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-3">
                    {vids.map((v) => (
                      <TakeCard
                        key={v.file}
                        take={v}
                        bundleId={id}
                        onToggleSelect={toggleVideo}
                        onOpenTrim={openTrim}
                      />
                    ))}
                  </View>
                </ScrollView>

                {trim ? (
                  <View className="mt-3 rounded-xl border border-border bg-card p-3">
                    <View className="mb-2 flex-row items-center gap-1.5">
                      <Scissors size={13} color={colors.foreground} />
                      <Text className="flex-1 text-[13px] font-semibold text-foreground">
                        Trim {trim.take.name || trim.take.file}
                      </Text>
                      {trim.dur > 0 ? (
                        <Text className="text-[12px] text-muted-foreground">
                          {trim.dur.toFixed(1)}s total
                        </Text>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View className="flex-1">
                        <Text className="mb-1 text-[11px] text-muted-foreground">In (s)</Text>
                        <Input
                          value={trimFrom}
                          onChangeText={setTrimFrom}
                          keyboardType="decimal-pad"
                          placeholder="0"
                        />
                      </View>
                      <View className="flex-1">
                        <Text className="mb-1 text-[11px] text-muted-foreground">Out (s)</Text>
                        <Input
                          value={trimTo}
                          onChangeText={setTrimTo}
                          keyboardType="decimal-pad"
                          placeholder={trim.dur > 0 ? trim.dur.toFixed(2) : 'end'}
                        />
                      </View>
                    </View>
                    <Text className="mt-2 text-[11px] leading-4 text-muted-foreground">
                      Creating a trim keeps the original and adds a new selectable take.
                    </Text>
                    <View className="mt-2 flex-row justify-end gap-2">
                      <Button size="sm" variant="ghost" title="Cancel" onPress={() => setTrim(null)} />
                      <Button
                        size="sm"
                        title="Create trim"
                        disabled={!trimValid || agentBusy}
                        onPress={createTrim}
                      >
                        <Scissors size={13} color={colors.primaryForeground} />
                      </Button>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* shots summary */}
            <View>
              <Eyebrow>Shots</Eyebrow>
              <View className="gap-2">
                {bundle.shots.map((s) => {
                  const dlg = shotDialogue(s);
                  return (
                    <View key={s.id} className="rounded-xl border border-border bg-card p-2.5">
                      <View className="mb-0.5 flex-row flex-wrap items-center gap-2">
                        <Badge label={s.id} variant="outline" />
                        <Text className="text-[11px] text-muted-foreground">
                          {s.dur ? `${s.dur}s · ` : ''}
                          {s.location || ''}
                          {s.camera ? ` · ${s.camera}` : ''}
                        </Text>
                      </View>
                      <Text className="text-[13px] text-foreground">{s.summary || ''}</Text>
                      {dlg ? (
                        <Text className="mt-0.5 text-[11px] text-muted-foreground">{dlg}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* image references */}
            <View>
              <Eyebrow>Image references ({picks.length})</Eyebrow>
              {assignedThumbs.length === 0 ? (
                <Text className="mb-2 text-[13px] text-muted-foreground">
                  No references chosen for this shot yet.
                </Text>
              ) : (
                <Galeria
                  urls={assignedThumbs.map((im) => mediaUrl(im.url) ?? '')}
                  theme={scheme}
                >
                <View className="mb-2 flex-row flex-wrap gap-2">
                  {assignedThumbs.map((im, idx) => (
                    <View key={im.rel} className="overflow-hidden rounded-lg border border-primary">
                      <Galeria.Image index={idx} style={{ width: cell, height: cell }}>
                        <Image
                          source={{ uri: mediaUrl(im.thumb) }}
                          style={{ width: cell, height: cell }}
                          contentFit="cover"
                        />
                      </Galeria.Image>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Remove reference"
                        className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60"
                        onPress={() => removeRef(im.rel)}
                      >
                        <X size={13} color={colors.primaryForeground} />
                      </Pressable>
                      <View className="bg-black/60 px-1.5 py-0.5" style={{ width: cell }}>
                        <Text className="text-[10px] text-white/90" numberOfLines={1}>
                          {refLabel(im.rel)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
                </Galeria>
              )}
              <View className="flex-row gap-2">
                <Button size="sm" variant="outline" title="Add references" onPress={addRefs}>
                  <Plus size={14} color={colors.foreground} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  title="Auto-assign"
                  loading={autoAssigning}
                  onPress={autoAssign}
                >
                  <Sparkles size={14} color={colors.foreground} />
                </Button>
              </View>
            </View>

            {/* audio references */}
            <View>
              <Eyebrow>Voice / sound references</Eyebrow>
              <View className="gap-2">
                {audioRefs.map((a) => {
                  const on = audioPicks.includes(a.rel);
                  return (
                    <Pressable
                      key={a.rel}
                      accessibilityRole="button"
                      className={cn(
                        'flex-row items-center gap-3 rounded-xl border p-3 active:opacity-70',
                        on ? 'border-primary bg-primary/10' : 'border-border bg-card',
                      )}
                      onPress={() => toggleAudio(a.rel, !on)}
                    >
                      <View
                        className={cn(
                          'h-7 w-7 items-center justify-center rounded-full border',
                          on ? 'border-primary bg-primary' : 'border-border',
                        )}
                      >
                        {on ? <Check size={14} color={colors.primaryForeground} /> : <Plus size={14} color={colors.subtleForeground} />}
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Volume2 size={13} color={on ? colors.primary : colors.subtleForeground} />
                          <Text className="text-[14px] font-medium text-foreground">{a.label}</Text>
                        </View>
                        {a.order && a.order.length > 1 ? (
                          <Text className="mt-0.5 text-[11px] text-muted-foreground">
                            voice order: {a.order.map((n, i) => `${i + 1}=${n}`).join(', ')}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* prompt editor */}
            {sec ? (
              <View>
                <View className="mb-2 flex-row items-center gap-2">
                  <Eyebrow className="mb-0 flex-1">Skill prompt</Eyebrow>
                  <Badge label={edited ? 'edited' : 'live'} variant={edited ? 'warning' : 'success'} />
                  {edited ? (
                    <Button size="sm" variant="outline" title="Reset" onPress={resetPrompt}>
                      <RotateCcw size={12} color={colors.foreground} />
                    </Button>
                  ) : null}
                </View>

                <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                  Audio / VFX restrictions
                </Text>
                <View className="mb-1.5 flex-row flex-wrap gap-2">
                  {RESTRICTIONS.map((r) => (
                    <Chip
                      key={r.key}
                      on={restr[r.key]}
                      label={r.label}
                      onPress={() =>
                        pushSec({
                          ...sec,
                          restrictionLine: lineFromRestrictions({ ...restr, [r.key]: !restr[r.key] }),
                        })
                      }
                    />
                  ))}
                </View>
                <View className="mb-3 rounded-lg bg-secondary px-3 py-2">
                  <Text className="text-[11px] text-muted-foreground" style={{ fontFamily: MONO }}>
                    {sec.restrictionLine || '(no restrictions — Seedance may add music, VFX & sound)'}
                  </Text>
                </View>

                <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">Style</Text>
                <Input
                  multiline
                  value={sec.styleLine}
                  onChangeText={(t) => pushSec({ ...sec, styleLine: t })}
                  className="mb-3 text-[12px]"
                  style={{ fontFamily: MONO }}
                />

                <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">Directives</Text>
                <Input
                  multiline
                  value={sec.directives}
                  onChangeText={(t) => pushSec({ ...sec, directives: t })}
                  className="mb-3 text-[12px]"
                  style={{ fontFamily: MONO }}
                />

                <Text className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                  Shot prompts ({sec.shots.length})
                </Text>
                <View className="gap-2">
                  {sec.shots.map((s, i) => (
                    <Input
                      key={i}
                      multiline
                      value={s}
                      onChangeText={(t) => {
                        const shots = sec.shots.slice();
                        shots[i] = t;
                        pushSec({ ...sec, shots });
                      }}
                      className="text-[12px]"
                      style={{ fontFamily: MONO }}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {/* revision signing */}
            <View>
              <Eyebrow>Revision signing</Eyebrow>
              <Text className="mb-1 text-[11px] text-muted-foreground">Signed by</Text>
              <Input value={signer} onChangeText={setSigner} placeholder="your name" className="mb-2" />
              <View className="gap-2">
                {SIGN_SECTIONS.map(({ key, label, hint }) => {
                  const sig = signoff?.[key] ?? null;
                  const on = !!sig;
                  return (
                    <View
                      key={key}
                      className={cn(
                        'flex-row items-center gap-3 rounded-xl border p-3',
                        on ? 'border-primary bg-primary/10' : 'border-border bg-card',
                      )}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={on ? `Unsign ${label}` : `Sign ${label}`}
                        className={cn(
                          'h-8 w-8 items-center justify-center rounded-full border',
                          on ? 'border-primary bg-primary' : 'border-border',
                        )}
                        onPress={() => onSign(key, !on)}
                      >
                        <Check size={16} color={on ? colors.primaryForeground : colors.border} />
                      </Pressable>
                      <View className="flex-1">
                        <Text className="text-[14px] font-medium text-foreground">{label}</Text>
                        <Text className="text-[11px] text-muted-foreground">
                          {sig ? `signed by ${sig.by} · ${new Date(sig.at).toLocaleString()}` : hint}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* render */}
            <Button
              title={agentBusy ? 'Agent is busy…' : 'Render with Seedance'}
              disabled={!fullySigned || agentBusy}
              onPress={requestRender}
            >
              <Wand2 size={15} color={colors.primaryForeground} />
            </Button>
            {!fullySigned ? (
              <Text className="-mt-4 text-center text-[11px] text-muted-foreground">
                Sign off images, prompt, and audio before rendering.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
