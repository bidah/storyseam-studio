import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  AudioLines,
  CircleAlert,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Mic,
  Send,
  X,
} from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { EditableField } from '@/components/story/field';
import { TakeAudioProvider, TakePlayButton } from '@/components/radio/take-player';
import type {
  AnimaticCoverage,
  CastingEntry,
  RadioLine,
  RadioPayload,
  RadioScene,
  VoiceRef,
} from '@/components/radio/types';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import { renderRadioSceneMessage } from '@/lib/agent/messages';
import { postJson, putJson } from '@/lib/api';
import { createPickerRequest } from '@/lib/picker-bus';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Radio screen — the audio-only dialogue pass, and the animatic built on top of
// it. Port of the web studio's src/routes/radio.jsx.
//
// It lives under the Cuts tab rather than as its own tab: iOS collapses a sixth
// native tab into a "More" list, and both of this screen's outputs (a radio
// timeline, an animatic) land in the Editor, which is what Cuts already opens.
//
// Scenes and lines are DERIVED from the shot list by the Worker — editing a
// line PUTs the intent (/api/radio/line/:id) and re-reads; nothing here owns
// document state.

/* ---------------------------------------------------------------- *
 * Casting row — one character + its cast voice.                      *
 * ---------------------------------------------------------------- */

function CastingRow({
  entry,
  onCast,
}: {
  entry: CastingEntry;
  onCast: (character: string, voiceRef: VoiceRef | null) => void;
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
          <Button size="sm" variant="outline" title="Cast voice" onPress={pickVoice}>
            <Mic size={13} color={colors.foreground} />
          </Button>
        </View>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Line — editable speaker + text, with its rendered take.            *
 * ---------------------------------------------------------------- */

function LineCard({
  line,
  onSaveLine,
}: {
  line: RadioLine;
  onSaveLine: (id: string, patch: { character?: string; text?: string }) => void;
}) {
  const take = line.take;
  const colors = useColors();
  return (
    <View className="gap-1.5 rounded-xl border border-border p-2.5">
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
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Screen                                                             *
 * ---------------------------------------------------------------- */

export default function RadioScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data, isLoading, error, refetch } = useProjectResource<RadioPayload>('radio');
  // Coverage is a nice-to-have: its own query, so a failure degrades the Build
  // animatic button instead of breaking the screen (the web loader has to
  // catch() for the same reason).
  const { data: animatic } = useProjectResource<AnimaticCoverage>('animatic');
  const invalidate = useInvalidate();
  const agent = useAgent();
  const busy = agentIsBusy(agent);
  const send = useSendToAgent();

  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);

  // The agent just rendered/attached takes → re-read when its turn ends. Fire
  // only on the transition INTO "ready", parity with the web tab.
  const status = agent?.status;
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

  const renderScene = async (scene: RadioScene) => {
    try {
      const turn = send(renderRadioSceneMessage(scene, scene.lines));
      toast('Sent to agent — watch the Chat tab');
      await turn;
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  // Just the voiced dialogue, as an audio-only timeline.
  const sendToEditor = async () => {
    setSending(true);
    try {
      await postJson('/api/radio/to-editor');
      invalidate('cuts');
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

  if (isLoading && !data) return <View className="flex-1 bg-background"><Loading /></View>;
  if (error && !data) {
    return (
      <View className="flex-1 bg-background">
        <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />
      </View>
    );
  }

  const scenes = data?.scenes ?? [];
  const casting = data?.casting ?? [];
  const uncast = casting.filter((c) => !c.voiceRef).length;

  return (
    <TakeAudioProvider>
      <View className="flex-1 bg-background">
        <ScrollView
          {...barInset}
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />
          }
        >
          <View className="gap-3">
            <Text className="text-sm text-muted-foreground">
              The audio-only pass — every scene&apos;s dialogue voiced with each character&apos;s
              cast voice. Send it to the Editor on its own, or build the animatic: the same
              dialogue with each shot&apos;s storyboard still on the picture track.
            </Text>

            <View className="flex-row flex-wrap items-center gap-2">
              <Badge variant="outline" label={`${scenes.length} scenes`} />
              <Badge variant="info" label={`${data?.readyLines || 0}/${data?.totalLines || 0} lines rendered`}>
                <AudioLines size={11} color={colors.info} />
              </Badge>
              {animatic && animatic.shots > 0 ? (
                <Badge
                  variant={animatic.withStill ? 'info' : 'muted'}
                  label={`${animatic.withStill}/${animatic.shots} shots with a still`}
                >
                  <ImageIcon size={11} color={animatic.withStill ? colors.info : colors.mutedForeground} />
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
                disabled={sending || building || !data?.readyLines}
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
                <CastingRow key={entry.character} entry={entry} onCast={cast} />
              ))
            )}
            <Text className="px-1 text-[11px] text-muted-foreground">
              Voices are seeded from the World tab and can be overridden here. Cast from your Sound
              Studio voice takes.
            </Text>
          </Card>

          {/* Scenes */}
          {scenes.length === 0 ? (
            <View className="rounded-2xl border border-dashed border-border">
              <Empty
                title="No dialogue yet"
                hint="Generate a shot list with spoken lines, then cast voices and render here."
              />
            </View>
          ) : (
            scenes.map((scene) => {
              const sceneUncast = scene.lines.some((l) => !l.voiceRef);
              return (
                <Card key={`${scene.beat}:${scene.lines[0]?.id}`} className="gap-2.5 p-3">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Film size={15} color={colors.primary} />
                    <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
                      {scene.beatTitle || scene.beat}
                    </Text>
                    <Badge variant="outline" label={`${scene.lines.length} lines`} />
                  </View>
                  <Button
                    size="sm"
                    className="self-start"
                    title={busy ? 'Agent working…' : 'Render scene'}
                    disabled={busy || sceneUncast}
                    onPress={() => renderScene(scene)}
                  >
                    <Mic size={13} color={colors.primaryForeground} />
                  </Button>
                  {sceneUncast ? (
                    <Text className="text-[11px] text-muted-foreground">
                      Cast a voice for every speaker in this scene first.
                    </Text>
                  ) : null}
                  {scene.lines.map((line) => (
                    <LineCard key={line.id} line={line} onSaveLine={saveLine} />
                  ))}
                </Card>
              );
            })
          )}
        </ScrollView>
      </View>
    </TakeAudioProvider>
  );
}
