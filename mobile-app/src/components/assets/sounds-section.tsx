import { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  Clock,
  Heart,
  MoreHorizontal,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Speech,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { agentIsBusy, useAgent, useSendToAgent } from '@/lib/agent/provider';
import { renderAllPendingMessage, renderSoundMessage } from '@/lib/agent/messages';
import { deleteJson, mediaUrl, patchJson, postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { cn } from '@/lib/utils';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import { CreateTrackSheet, EditVersionSheet } from './sound-sheets';
import { trackKind, type SoundTrack, type SoundVersion, type TrackKind } from './types';

// Sound studio: Music | SFX | Voice segments over the shared /api/sounds
// store. Version rows: status badge, like, inline play (one player at a
// time), edit sheet, delete, Render-via-agent for pending versions.

const SENT_TOAST = 'Sent to agent — watch the Chat tab';

// Single mounted player — keyed by URL so switching versions remounts it
// (useAudioPlayer doesn't chase source changes). Unmount releases the player.
function AudioHost({ url, onDone }: { url: string; onDone: () => void }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    player.play();
  }, [player]);
  useEffect(() => {
    if (status.didJustFinish) onDone();
  }, [status.didJustFinish, onDone]);
  return null;
}

function VersionRow({
  track,
  ver,
  playing,
  onTogglePlay,
  onEdit,
}: {
  track: SoundTrack;
  ver: SoundVersion;
  playing: boolean;
  onTogglePlay: () => void;
  onEdit: () => void;
}) {
  const colors = useColors();
  const invalidate = useInvalidate();
  // Selected: this screen only asks whether a turn is running, so it must not
  // re-render on every streamed batch (see useAgent in lib/agent/provider).
  const agentBusy = useAgent(agentIsBusy);
  const [busy, setBusy] = useState(false);
  const ready = ver.status === 'ready';

  const run = async (fn: () => Promise<unknown>, failLabel: string) => {
    setBusy(true);
    try {
      await fn();
      invalidate('sounds');
    } catch (e: any) {
      toast.error(`${failLabel}: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = () =>
    run(() => postJson(`/api/sounds/${track.id}/version/${ver.v}/like`), 'Like failed');

  const del = () =>
    Alert.alert(`Delete v${ver.v}?`, 'This version and its audio are removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(() => deleteJson(`/api/sounds/${track.id}/version/${ver.v}`), 'Delete failed'),
      },
    ]);

  const sendToAgent = useSendToAgent();
  const requestRender = async () => {
    try {
      await sendToAgent(renderSoundMessage(track, ver));
      toast(SENT_TOAST);
    } catch (e: any) {
      toast.error(`Agent send failed: ${e?.message || e}`);
    }
  };

  return (
    <View
      className={cn(
        'gap-2 rounded-xl border border-border bg-secondary/40 p-3',
        ver.liked && 'border-primary/40',
      )}
    >
      <View className="flex-row items-center gap-2">
        <Badge variant="muted" label={`v${ver.v}`} />
        {ver.name ? (
          <Text className="flex-1 text-[13px] font-medium text-foreground" numberOfLines={1}>
            {ver.name}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {ready ? (
          <Badge variant="success" label="ready" />
        ) : (
          <Badge variant="warning" label="pending">
            <Clock size={10} color={colors.amber} />
          </Badge>
        )}
        {ver.duration ? (
          <Text className="text-[11px] text-muted-foreground">{ver.duration.toFixed(1)}s</Text>
        ) : null}
      </View>

      <Text className="text-[12px] leading-snug text-muted-foreground" numberOfLines={2}>
        {ver.prompt}
      </Text>

      <View className="flex-row items-center gap-1">
        {ready && ver.url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            className="h-9 w-9 items-center justify-center rounded-full bg-secondary active:opacity-60"
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onTogglePlay();
            }}
          >
            {playing ? <Pause size={16} color={colors.primary} /> : <Play size={16} color={colors.foreground} />}
          </Pressable>
        ) : null}
        {!ready ? (
          <Button size="sm" disabled={agentBusy} onPress={requestRender}>
            <Wand2 size={13} color={colors.primaryForeground} />
            <Text className="text-[13px] font-semibold text-primary-foreground">Render</Text>
          </Button>
        ) : null}
        <View className="flex-1" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ver.liked ? 'Unlike this version' : 'Like this version'}
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          disabled={busy}
          onPress={toggleLike}
        >
          <Heart
            size={17}
            color={ver.liked ? colors.destructive : colors.mutedForeground}
            fill={ver.liked ? colors.destructive : 'none'}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit this version"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          onPress={onEdit}
        >
          <Pencil size={15} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete this version"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          disabled={busy}
          onPress={del}
        >
          <Trash2 size={15} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

const KIND_ICON: Record<TrackKind, React.ComponentType<any>> = {
  music: Music,
  sfx: Volume2,
  voice: Speech,
};

function TrackCard({
  track,
  playingKey,
  onTogglePlay,
  onEdit,
}: {
  track: SoundTrack;
  playingKey: string | null;
  onTogglePlay: (key: string, url: string) => void;
  onEdit: (track: SoundTrack, ver: SoundVersion) => void;
}) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const Icon = KIND_ICON[trackKind(track)];
  const liked = track.versions.some((v) => v.liked);
  const versions = [...track.versions].sort((a, b) => b.v - a.v);

  const rename = () => {
    if (Platform.OS !== 'ios') {
      toast.error('Rename is available on iOS only for now');
      return;
    }
    Alert.prompt(
      'Rename track',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: async (name?: string) => {
            const next = name?.trim();
            if (!next || next === track.name) return;
            try {
              await patchJson(`/api/sounds/${track.id}`, { name: next });
              invalidate('sounds');
            } catch (e: any) {
              toast.error(`Rename failed: ${e?.message || e}`);
            }
          },
        },
      ],
      'plain-text',
      track.name,
    );
  };

  const del = () =>
    Alert.alert(`Delete "${track.name}"?`, 'The track and all its versions are removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteJson(`/api/sounds/${track.id}`);
            invalidate('sounds');
            toast.success('Track deleted');
          } catch (e: any) {
            toast.error(`Delete failed: ${e?.message || e}`);
          }
        },
      },
    ]);

  const menu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: track.name,
          options: ['Rename', 'Delete track', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) rename();
          else if (i === 1) del();
        },
      );
    } else {
      Alert.alert(track.name, undefined, [
        { text: 'Delete track', style: 'destructive', onPress: del },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <Card className="mb-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Icon size={17} color={colors.primary} />
        <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {track.name}
        </Text>
        {liked ? <Heart size={14} color={colors.destructive} fill={colors.destructive} /> : null}
        <Text className="text-[11px] text-muted-foreground">
          {track.versions.length} version{track.versions.length === 1 ? '' : 's'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Track actions"
          className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
          onPress={menu}
        >
          <MoreHorizontal size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {versions.map((v) => {
        const key = `${track.id}:${v.v}`;
        return (
          <VersionRow
            key={key}
            track={track}
            ver={v}
            playing={playingKey === key}
            onTogglePlay={() => {
              const url = mediaUrl(v.url);
              if (url) onTogglePlay(key, url);
            }}
            onEdit={() => onEdit(track, v)}
          />
        );
      })}
    </Card>
  );
}

export function SoundsSection() {
  const barInset = useTabBarScrollProps();
  const { data, isPending, error, refetch } = useProjectResource<{
    tracks: SoundTrack[];
  }>('sounds');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const colors = useColors();
  const invalidate = useInvalidate();
  // Selected: this screen only asks whether a turn is running, so it must not
  // re-render on every streamed batch (see useAgent in lib/agent/provider).
  const agentBusy = useAgent(agentIsBusy);

  const [kind, setKind] = useState<TrackKind>('music');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<{ track: SoundTrack; ver: SoundVersion } | null>(null);
  const [nowPlaying, setNowPlaying] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const tracks = useMemo(() => data?.tracks ?? [], [data]);
  const filtered = useMemo(() => tracks.filter((t) => trackKind(t) === kind), [tracks, kind]);
  const pending = tracks.reduce(
    (n, t) => n + t.versions.filter((v) => v.status !== 'ready').length,
    0,
  );

  const togglePlay = (key: string, url: string) =>
    setNowPlaying((cur) => (cur?.key === key ? null : { key, url }));

  const sendToAgent = useSendToAgent();
  const renderAll = async () => {
    try {
      await sendToAgent(renderAllPendingMessage(tracks));
      toast(SENT_TOAST);
    } catch (e: any) {
      toast.error(`Agent send failed: ${e?.message || e}`);
    }
  };

  if (isPending) return <Loading />;
  if (error)
    return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;

  const emptyText =
    kind === 'music'
      ? 'No background music yet'
      : kind === 'sfx'
        ? 'No sound effects yet'
        : 'No voice lines yet';

  return (
    <View className="flex-1">
      <View className="gap-2.5 px-4 pt-3">
        <SegmentedNative<TrackKind>
          options={[
            { value: 'music', label: 'Music' },
            { value: 'sfx', label: 'SFX' },
            { value: 'voice', label: 'Voice' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <View className="flex-row items-center gap-2">
          <Button size="sm" onPress={() => setCreateOpen(true)}>
            <Plus size={14} color={colors.primaryForeground} />
            <Text className="text-[13px] font-semibold text-primary-foreground">New track</Text>
          </Button>
          {pending > 0 ? (
            <Button size="sm" variant="outline" disabled={agentBusy} onPress={renderAll}>
              <Wand2 size={13} color={colors.foreground} />
              <Text className="text-[13px] font-semibold text-foreground">
                Render all pending ({pending})
              </Text>
            </Button>
          ) : null}
        </View>
      </View>

      <FlatList
        {...barInset}
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerClassName="px-4 pb-8 pt-3"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />
        }
        ListEmptyComponent={<Empty title={emptyText} hint='Tap "New track" to create one.' />}
        renderItem={({ item }) => (
          <TrackCard
            track={item}
            playingKey={nowPlaying?.key ?? null}
            onTogglePlay={togglePlay}
            onEdit={(track, ver) => setEditing({ track, ver })}
          />
        )}
      />

      {nowPlaying ? (
        <AudioHost
          key={nowPlaying.key}
          url={nowPlaying.url}
          onDone={() => setNowPlaying(null)}
        />
      ) : null}

      <CreateTrackSheet
        visible={createOpen}
        initialKind={kind}
        onClose={() => setCreateOpen(false)}
        onCreated={() => invalidate('sounds')}
      />
      <EditVersionSheet
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => invalidate('sounds')}
      />
    </View>
  );
}
