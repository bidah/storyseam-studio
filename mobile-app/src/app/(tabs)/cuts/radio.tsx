import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Host, Switch } from '@expo/ui';
import {
  AudioLines,
  Bot,
  Check,
  CircleAlert,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Mic,
  Plus,
  RotateCcw,
  Send,
  X,
} from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { EditableField } from '@/components/story/field';
import { CreateTrackSheet } from '@/components/assets/sound-sheets';
import { TakeAudioProvider, TakePlayButton } from '@/components/radio/take-player';
import type {
  AnimaticCoverage,
  CastingEntry,
  RadioLine,
  RadioPayload,
  RadioScene,
  RadioTake,
  VoiceRef,
} from '@/components/radio/types';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import {
  castVoiceMessage,
  paceRadioTimelineMessage,
  recreateRadioLineMessage,
  renderRadioSceneMessage,
} from '@/lib/agent/messages';
import { postJson, putJson } from '@/lib/api';
import { createPickerRequest } from '@/lib/picker-bus';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Radio screen — the audio-only dialogue pass, and the animatic built on top of
// it. Port of the web studio's src/routes/radio.jsx, at full feature parity:
// casting (by hand or by agent), per-scene render, per-line recreate + take
// version selection, and Send to editor with the agent pacing pass.
//
// It lives under the Cuts tab rather than as its own tab: iOS collapses a sixth
// native tab into a "More" list, and both of this screen's outputs (a radio
// timeline, an animatic) land in the Editor, which is what Cuts already opens.
//
// Scenes and lines are DERIVED from the shot list by the Worker — editing a
// line PUTs the intent (/api/radio/line/:id) and re-reads; nothing here owns
// document state.
//
// Structure is a SectionList, one section per scene, with STICKY headers: the
// scene's "Render scene" button rides the top of the screen for as long as any
// of that scene's lines are visible, so it can't scroll out of reach on a phone
// (the web lays it out in a panel header that's always on screen anyway).

const PACING_KEY = 'shot-studio.radioAgentPacing';

/**
 * "Agent pacing" — persisted like the web tab's localStorage flag, defaulting
 * to ON. Hydrates async, so the switch is remounted (`nonce`) once the stored
 * value lands: a native switch keeps its own internal state and would otherwise
 * stay where it was first rendered.
 */
function usePacingPref() {
  const [on, setOn] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(PACING_KEY)
      .then((v) => {
        if (!alive || v == null) return;
        const next = v !== 'off';
        setOn(next);
        setNonce((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const set = useCallback((next: boolean) => {
    setOn(next);
    AsyncStorage.setItem(PACING_KEY, next ? 'on' : 'off').catch(() => {});
  }, []);

  return { on, set, nonce };
}

/* ---------------------------------------------------------------- *
 * Casting row — one character + its cast voice.                      *
 * ---------------------------------------------------------------- */

function CastingRow({
  entry,
  onCast,
  onAgentCast,
  agentBusy,
}: {
  entry: CastingEntry;
  onCast: (character: string, voiceRef: VoiceRef | null) => void;
  onAgentCast: (characters: string | string[]) => void;
  agentBusy: boolean;
}) {
  const { character, voiceRef, source } = entry;
  const colors = useColors();

  // Reuses the existing /sound-picker sheet: it already resolves exactly the
  // { trackId, v, name, url } voiceRef this endpoint wants.
  const pickVoice = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/sound-picker', params: { requestId } });
    const picked = (await promise) as VoiceRef | null;
    if (picked) onCast(character, picked);
  };

  return (
    <View className="gap-2 rounded-xl border border-border p-2.5">
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant="outline" label={character} />
        {source === 'world' && voiceRef ? <Badge variant="muted" label="from World" /> : null}
      </View>
      {voiceRef ? (
        <View className="flex-row items-center gap-2">
          <Mic size={15} color={colors.primary} />
          <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
            {voiceRef.name || 'Voice'}
            {voiceRef.v != null ? (
              <Text className="text-muted-foreground"> · v{voiceRef.v}</Text>
            ) : null}
          </Text>
          <TakePlayButton url={voiceRef.url || null} label={`${character}'s voice`} />
          <Button
            size="sm"
            variant="outline"
            title="Change"
            onPress={pickVoice}
            accessibilityLabel={`Change ${character}'s voice`}
          />
          <Button
            size="icon"
            variant="ghost"
            accessibilityLabel={`Clear ${character}'s voice`}
            onPress={() => onCast(character, null)}
          >
            <X size={16} color={colors.mutedForeground} />
          </Button>
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-sm text-muted-foreground">no voice cast</Text>
          {/* Delegate to the agent: it designs, renders, likes and casts a voice,
              picking attach_character_voice or cast_radio_voice per name. */}
          <Button
            size="sm"
            variant="secondary"
            title="Agent"
            disabled={agentBusy}
            accessibilityLabel={`Have the agent cast a voice for ${character}`}
            onPress={() => onAgentCast(character)}
          >
            <Bot size={13} color={colors.foreground} />
          </Button>
          <Button size="sm" variant="outline" title="Cast voice" onPress={pickVoice}>
            <Mic size={13} color={colors.foreground} />
          </Button>
        </View>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Take version pills — which rendered take is active for a line.     *
 * ---------------------------------------------------------------- */

function TakePills({
  takes,
  onSelect,
}: {
  takes: RadioTake[];
  onSelect: (take: RadioTake) => void;
}) {
  const colors = useColors();
  if (takes.length < 2) return null;
  return (
    <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
      <Text className="text-[10px] uppercase tracking-wide text-muted-foreground">takes</Text>
      {takes.map((t, i) => {
        const missing = t.status === 'missing';
        return (
          <Pressable
            key={`${t.trackId}:${t.v}`}
            disabled={t.selected || missing}
            accessibilityRole="button"
            accessibilityLabel={
              missing
                ? `Take ${i + 1} — audio is gone`
                : t.selected
                  ? `Take ${i + 1} — the active take`
                  : `Use take ${i + 1}`
            }
            onPress={() => onSelect(t)}
            className={[
              'flex-row items-center gap-1 rounded-md border px-2 py-0.5 active:opacity-70',
              t.selected ? 'border-primary bg-primary/10' : 'border-border',
              !t.ready && !missing ? 'opacity-70' : '',
            ].join(' ')}
          >
            {t.selected ? <Check size={11} color={colors.primary} /> : null}
            <Text
              className={[
                'text-[11px] font-medium',
                t.selected ? 'text-primary' : 'text-foreground',
                missing ? 'text-muted-foreground line-through' : '',
              ].join(' ')}
            >
              v{i + 1}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Line — editable speaker + text, with its rendered take.            *
 * ---------------------------------------------------------------- */

function LineCard({
  line,
  onSaveLine,
  onRecreate,
  onSelectVersion,
  agentBusy,
}: {
  line: RadioLine;
  onSaveLine: (id: string, patch: { character?: string; text?: string }) => void;
  onRecreate: () => void;
  onSelectVersion: (take: RadioTake) => void;
  agentBusy: boolean;
}) {
  const take = line.take;
  const takes = line.takes ?? [];
  const colors = useColors();
  // Web calls this "Recreate take" only once a take exists — before that it's
  // the first render of the line.
  const recreateLabel = takes.length ? 'Recreate take' : 'Render take';
  return (
    <View className="mb-2 gap-1.5 rounded-xl border border-border p-2.5">
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant="outline" label={`shot ${line.shotId}`} />
        {line.voiceRef ? (
          <Badge variant="success" label={line.voiceRef.name || 'voice'}>
            <Mic size={10} color={colors.primary} />
          </Badge>
        ) : (
          <Badge variant="warning" label="no voice">
            <CircleAlert size={10} color={colors.amber} />
          </Badge>
        )}
        <View className="ml-auto flex-row items-center gap-1">
          {take?.ready ? (
            <TakePlayButton url={take.url} label={`${line.character || 'line'} take`} />
          ) : take && take.status !== 'missing' ? (
            <Badge variant="info" label={take.status} />
          ) : (
            <Badge variant="muted" label="not rendered" />
          )}
          {/* Web hides this behind a kebab; a phone has room for the action
              itself, and a one-tap Recreate is the whole point of reviewing
              takes on a couch. Needs a cast voice, like the web menu item. */}
          <Button
            size="icon"
            variant="ghost"
            disabled={agentBusy || !line.voiceRef}
            accessibilityLabel={`${recreateLabel} for ${line.character || 'this line'}`}
            onPress={onRecreate}
          >
            <RotateCcw
              size={15}
              color={agentBusy || !line.voiceRef ? colors.mutedForeground : colors.foreground}
            />
          </Button>
        </View>
      </View>
      <EditableField
        label="Speaker"
        value={line.character}
        placeholder="Speaker"
        multiline={false}
        onCommit={(v) => onSaveLine(line.id, { character: v })}
      />
      <EditableField
        label="Line"
        value={line.text}
        placeholder="Dialogue line"
        onCommit={(v) => onSaveLine(line.id, { text: v })}
      />
      <TakePills takes={takes} onSelect={onSelectVersion} />
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Screen                                                             *
 * ---------------------------------------------------------------- */

type Section = {
  key: string;
  scene: RadioScene;
  data: RadioLine[];
};

export default function RadioScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data, isLoading, error, refetch } = useProjectResource<RadioPayload>('radio');
  // Coverage is a nice-to-have: its own query, so a failure degrades the Build
  // animatic button instead of breaking the screen (the web loader has to
  // catch() for the same reason).
  const { data: animatic } = useProjectResource<AnimaticCoverage>('animatic');
  const invalidate = useInvalidate();
  // Selected down to the status string: this screen watches for the turn ENDING,
  // and must not re-render on every streamed batch (see useAgent in the provider).
  const status = useAgent((a) => a.status);
  const busy = agentIsBusy({ status });
  const send = useSendToAgent();

  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [newVoiceOpen, setNewVoiceOpen] = useState(false);
  const pacing = usePacingPref();

  // Which scene's "Render scene" was actually launched — so only THAT header
  // shows "working…". Without it the global busy flag flips every scene's
  // button (even for a single-line recreate), which reads as "beat 2 started
  // rendering" when it didn't. Cleared when the agent idles.
  // Derived, not an effect: once the agent idles the launched scene is stale by
  // definition, so reading it through `busy` clears it without a render pass.
  const [launchedScene, setLaunchedScene] = useState<string | null>(null);
  const renderingScene = busy ? launchedScene : null;

  // The agent just rendered/attached takes → re-read when its turn ends. Fire
  // only on the transition INTO "ready", parity with the web tab.
  const prevStatus = useRef(status);
  useEffect(() => {
    const enteredReady = status === 'ready' && prevStatus.current !== 'ready';
    prevStatus.current = status;
    if (enteredReady) invalidate('radio', 'animatic');
  }, [status, invalidate]);

  const mutate = useCallback(
    async (path: string, body: unknown) => {
      try {
        await putJson(path, body);
        invalidate('radio', 'animatic');
      } catch (e: any) {
        toast.error(String(e?.message || e));
      }
    },
    [invalidate],
  );

  const cast = (character: string, voiceRef: VoiceRef | null) =>
    mutate('/api/radio/casting', { character, voiceRef });
  const saveLine = (id: string, patch: { character?: string; text?: string }) =>
    mutate(`/api/radio/line/${encodeURIComponent(id)}`, patch);

  // Pick which rendered take is active for a line. buildRadioView resolves the
  // selection as line.take, so Send to editor / pacing / the animatic all follow
  // the pick.
  const selectVersion = useCallback(
    async (id: string, take: RadioTake) => {
      try {
        await postJson(`/api/radio/take/${encodeURIComponent(id)}/select`, {
          trackId: take.trackId,
          v: take.v,
          selected: true,
        });
        invalidate('radio', 'animatic');
      } catch (e: any) {
        toast.error(String(e?.message || 'Select failed'));
      }
    },
    [invalidate],
  );

  const sceneKey = (s: RadioScene) => `${s.beat}:${s.lines[0]?.id}`;

  // `send` returns the turn's promise — or undefined when no conversation is
  // live yet (it's `getAgent()?.send?.(…)`). Normalize before chaining, or the
  // very first tap of the session throws instead of starting a turn.
  const dispatch = useCallback(
    (message: string, onFail?: () => void) => {
      toast('Sent to agent — watch the Chat tab');
      Promise.resolve(send(message)).catch((e: any) => {
        onFail?.();
        toast.error(String(e?.message || e));
      });
    },
    [send],
  );

  const renderScene = (scene: RadioScene) => {
    setLaunchedScene(sceneKey(scene));
    dispatch(renderRadioSceneMessage(scene, scene.lines), () => setLaunchedScene(null));
  };

  const recreateLine = (scene: RadioScene, line: RadioLine) =>
    dispatch(recreateRadioLineMessage(scene, line));

  const voiceWithAgent = useCallback(
    (characters: string | string[]) => dispatch(castVoiceMessage(characters)),
    [dispatch],
  );

  // Just the voiced dialogue, as an audio-only timeline. With "Agent pacing" on
  // this also hands the agent the editorial second pass (radio-pacing skill) —
  // the re-timed gaps land in the Editor live when its turn ends.
  const sendToEditor = async () => {
    const paced = pacing.on;
    setSending(true);
    try {
      await postJson('/api/radio/to-editor');
      invalidate('cuts');
      // The gapless first pass is built deterministically either way; pacing is
      // the agent's editorial second pass on top of it, landing live in the
      // Editor via timeline SSE when its turn ends.
      if (paced) Promise.resolve(send(paceRadioTimelineMessage())).catch(() => {});
      router.push('/editor');
    } catch (e: any) {
      toast.error(String(e?.message || 'Send failed'));
    } finally {
      setSending(false);
    }
  };

  // The animatic: this radio pass PLUS each shot's storyboard still on the
  // picture track. Unlike "Send to editor" it covers every shot (silent ones
  // included), so it works — as an all-slate outline — before any still exists.
  const buildAnimatic = async () => {
    setBuilding(true);
    try {
      const res = await postJson<{ warning?: string }>('/api/animatic/to-editor');
      if (res?.warning) toast(res.warning);
      invalidate('cuts');
      router.push('/editor');
    } catch (e: any) {
      toast.error(String(e?.message || 'Build failed'));
    } finally {
      setBuilding(false);
    }
  };

  const scenes = useMemo(() => data?.scenes ?? [], [data]);
  const sections = useMemo<Section[]>(
    () =>
      scenes.map((scene) => ({
        key: `${scene.beat}:${scene.lines[0]?.id}`,
        scene,
        data: scene.lines,
      })),
    [scenes],
  );
  const casting = data?.casting ?? [];
  const uncastNames = casting.filter((c) => !c.voiceRef).map((c) => c.character);
  const uncast = uncastNames.length;

  if (isLoading && !data)
    return (
      <View className="flex-1 bg-background">
        <Loading />
      </View>
    );
  if (error && !data) {
    return (
      <View className="flex-1 bg-background">
        <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />
      </View>
    );
  }

  const header = (
    <View className="gap-4 pb-2 pt-4">
      <View className="gap-3">
        <Text className="text-sm text-muted-foreground">
          The audio-only pass — every scene&apos;s dialogue voiced with each character&apos;s cast
          voice. Send it to the Editor on its own, or build the animatic: the same dialogue with
          each shot&apos;s storyboard still on the picture track.
        </Text>

        <View className="flex-row flex-wrap items-center gap-2">
          <Badge variant="outline" label={`${scenes.length} scenes`} />
          <Badge
            variant="info"
            label={`${data?.readyLines || 0}/${data?.totalLines || 0} lines rendered`}
          >
            <AudioLines size={11} color={colors.info} />
          </Badge>
          {animatic && animatic.shots > 0 ? (
            <Badge
              variant={animatic.withStill ? 'info' : 'muted'}
              label={`${animatic.withStill}/${animatic.shots} shots with a still`}
            >
              <ImageIcon
                size={11}
                color={animatic.withStill ? colors.info : colors.mutedForeground}
              />
            </Badge>
          ) : null}
          {uncast > 0 ? (
            <Badge
              variant="warning"
              label={`${uncast} character${uncast > 1 ? 's' : ''} without a voice`}
            >
              <CircleAlert size={11} color={colors.amber} />
            </Badge>
          ) : null}
          {/* A shot that belongs to no bundle can't be matched to a still —
              in practice the shot list's ids have drifted from the episode
              manifest's. Show it rather than quietly building slates. */}
          {animatic && animatic.unmatched > 0 ? (
            <Badge
              variant="warning"
              label={`${animatic.unmatched} shot${animatic.unmatched > 1 ? 's' : ''} not in any bundle`}
            >
              <CircleAlert size={11} color={colors.amber} />
            </Badge>
          ) : null}
        </View>

        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            variant="outline"
            title="Send to editor"
            loading={sending}
            disabled={sending || building || !data?.readyLines || (pacing.on && busy)}
            onPress={sendToEditor}
          >
            {sending ? null : <Send size={14} color={colors.foreground} />}
          </Button>
          <Button
            className="flex-1"
            title="Build animatic"
            loading={building}
            disabled={building || sending || !animatic?.shots}
            onPress={buildAnimatic}
          >
            {building ? null : <Clapperboard size={14} color={colors.primaryForeground} />}
          </Button>
        </View>

        {/* Agent pacing rides WITH "Send to editor": on, the gapless first pass
            is still built deterministically, then the agent re-times the gaps. */}
        <View className="flex-row items-center gap-2 rounded-xl border border-border p-2.5">
          <View className="flex-1">
            <Text className="text-[14px] font-medium text-foreground">Agent pacing</Text>
            <Text className="text-[12px] text-muted-foreground">
              After sending, have the agent space the lines from the shot timings so the story
              breathes.
            </Text>
          </View>
          <View pointerEvents={sending ? 'none' : 'auto'} className={sending ? 'opacity-40' : ''}>
            <Host matchContents key={pacing.nonce}>
              <Switch value={pacing.on} onValueChange={pacing.set} />
            </Host>
          </View>
        </View>

        {animatic?.shots ? (
          <Text className="text-xs text-muted-foreground">
            Build animatic: {animatic.shots} shots — {animatic.withStill} with a still,{' '}
            {animatic.slates} slate{animatic.slates === 1 ? '' : 's'}.
          </Text>
        ) : (
          <Text className="text-xs text-muted-foreground">
            Write a shot list first to build an animatic.
          </Text>
        )}
      </View>

      {/* Casting */}
      <Card className="gap-2 p-3">
        <View className="flex-row items-center gap-2">
          <Mic size={15} color={colors.primary} />
          <Eyebrow className="mb-0">Casting</Eyebrow>
          <View className="ml-auto">
            <Badge variant="outline" label={String(casting.length)} />
          </View>
        </View>
        {casting.length === 0 ? (
          <Empty title="No speaking characters" hint="None found in the shot list." />
        ) : (
          casting.map((entry) => (
            <CastingRow
              key={entry.character}
              entry={entry}
              onCast={cast}
              onAgentCast={voiceWithAgent}
              agentBusy={busy}
            />
          ))
        )}
        <View className="flex-row gap-2">
          {uncast > 0 ? (
            <Button
              className="flex-1"
              size="sm"
              variant="secondary"
              title={busy ? 'Agent working…' : `Voice ${uncast} uncast`}
              disabled={busy}
              onPress={() => voiceWithAgent(uncastNames)}
            >
              {busy ? null : <Bot size={13} color={colors.foreground} />}
            </Button>
          ) : null}
          <Button
            className="flex-1"
            size="sm"
            variant="outline"
            title="Create voice"
            onPress={() => setNewVoiceOpen(true)}
          >
            <Plus size={13} color={colors.foreground} />
          </Button>
        </View>
        <Text className="px-1 text-[11px] text-muted-foreground">
          Voices are seeded from the World tab and can be overridden here. Cast from your Sound
          Studio voice takes, or let the agent design and cast one.
        </Text>
      </Card>
    </View>
  );

  return (
    <TakeAudioProvider>
      <View className="flex-1 bg-background">
        <SectionList
          {...barInset}
          className="flex-1 px-4"
          sections={sections}
          keyExtractor={(line) => line.id}
          // The scene's render button stays reachable for as long as any of its
          // lines are on screen — the reason this is a SectionList at all.
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.mutedForeground}
            />
          }
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View className="mt-4 rounded-2xl border border-dashed border-border">
              <Empty
                title="No dialogue yet"
                hint="Generate a shot list with spoken lines, then cast voices and render here."
              />
            </View>
          }
          renderSectionHeader={({ section }) => {
            const { scene } = section as Section;
            const sceneUncast = scene.lines.some((l) => !l.voiceRef);
            const rendering = busy && renderingScene === sceneKey(scene);
            // Every line has a take → the scene is done. Disable and flip the
            // label so it can't be re-launched by accident.
            const sceneRendered = scene.lines.every((l) => l.take);
            return (
              <View className="border-b border-border bg-background pb-2 pt-3">
                <View className="flex-row items-center gap-2">
                  <Film size={15} color={colors.primary} />
                  <Text
                    className="flex-1 text-[15px] font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {scene.beatTitle || scene.beat}
                  </Text>
                  <Badge variant="outline" label={`${scene.lines.length} lines`} />
                  <Button
                    size="sm"
                    title={
                      rendering
                        ? 'working…'
                        : sceneRendered
                          ? 'Rendered'
                          : busy
                            ? 'Agent working…'
                            : 'Render scene'
                    }
                    loading={rendering}
                    disabled={busy || sceneUncast || (sceneRendered && !rendering)}
                    onPress={() => renderScene(scene)}
                  >
                    {rendering ? null : sceneRendered ? (
                      <Check size={13} color={colors.primaryForeground} />
                    ) : (
                      <Mic size={13} color={colors.primaryForeground} />
                    )}
                  </Button>
                </View>
                {sceneUncast ? (
                  <Text className="pt-1 text-[11px] text-muted-foreground">
                    Cast a voice for every speaker in this scene first.
                  </Text>
                ) : null}
              </View>
            );
          }}
          renderItem={({ item, section }) => (
            <LineCard
              line={item}
              onSaveLine={saveLine}
              onRecreate={() => recreateLine((section as Section).scene, item)}
              onSelectVersion={(take) => selectVersion(item.id, take)}
              agentBusy={busy}
            />
          )}
        />

        {/* Create a brand-new voice without leaving Radio — the mobile stand-in
            for the web dialog's "Create voice" shortcut into /sounds?new=voice. */}
        <CreateTrackSheet
          visible={newVoiceOpen}
          initialKind="voice"
          onClose={() => setNewVoiceOpen(false)}
          onCreated={() => invalidate('sounds')}
        />
      </View>
    </TakeAudioProvider>
  );
}
