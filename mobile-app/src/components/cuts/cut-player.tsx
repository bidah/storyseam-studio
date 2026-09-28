import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { Clapperboard, Music } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { mediaUrl, toPreviewSrc } from '@/lib/api';
import { fmtTime, segDuration, type CutGen } from './types';

// One cut generation playing in a 16:9 expo-video view + the "now playing"
// strip: a horizontal row of segment chips (and, for a scored cut, music-cue
// chips) laid out in timeline order. Tapping a chip seeks the player to that
// segment's start; the chip whose from→to window contains the playhead is
// highlighted (port of the web app's NowPlayingCut overlay + marker strip).

type StripItem = {
  kind: 'seg' | 'cue';
  key: string;
  start: number;
  end: number;
  label: string;
  sub?: string;
};

export function CutPlayer({ gen, autoPlay = false }: { gen: CutGen; autoPlay?: boolean }) {
  const colors = useColors();
  // Playback goes through the 720p preview proxy; `at`/`v` doubles as the
  // media cache-bust nonce (a re-stitch can reuse the same output URL).
  const src = mediaUrl(
    toPreviewSrc(gen.url),
    gen.at ? encodeURIComponent(gen.at) : gen.v,
  );

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // useVideoPlayer recreates the player whenever the source string changes
  // (swapping versions), re-running setup — so autoplay kicks in exactly when
  // the user picked a version from history.
  const player = useVideoPlayer(src ?? null, (p) => {
    p.timeUpdateEventInterval = 0.25;
    if (autoPlayRef.current) p.play();
  });

  const [t, setT] = useState(0);
  useEventListener(player, 'timeUpdate', (payload) => setT(payload.currentTime));

  const items = useMemo<StripItem[]>(() => {
    const segs: StripItem[] = (gen.segments ?? [])
      .filter((s) => s.file)
      .map((s) => ({
        kind: 'seg',
        key: `seg-${s.id}`,
        start: s.start,
        end: s.end,
        label: s.name || s.id,
        sub: `${segDuration(s).toFixed(1)}s`,
      }));
    // Music-cue markers only make sense on a scored cut (parity with web).
    const cues: StripItem[] =
      gen.kind === 'scored'
        ? (gen.music ?? []).map((m) => ({
            kind: 'cue',
            key: `cue-${m.track}-${m.start}`,
            start: m.start,
            end: m.beatEnd,
            label: m.label || m.name || m.track,
          }))
        : [];
    return [...segs, ...cues].sort(
      (a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'seg' ? -1 : 1),
    );
  }, [gen]);

  const seek = (to: number) => {
    Haptics.selectionAsync().catch(() => {});
    player.currentTime = Math.max(0, to);
    setT(to);
  };

  return (
    <View style={styles.root}>
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          style={{ width: '100%', aspectRatio: 16 / 9 }}
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture={false}
        />
      </View>

      {items.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
        >
          {items.map((it) => {
            const active = t >= it.start && t < it.end;
            const isCue = it.kind === 'cue';
            return (
              <Pressable
                key={it.key}
                accessibilityRole="button"
                accessibilityLabel={`${isCue ? 'Music cue' : 'Segment'} ${it.label} — seek to ${fmtTime(it.start)}`}
                onPress={() => seek(it.start)}
                style={({ pressed }) => [
                  styles.chip,
                  active && !isCue && styles.chipActivePrimary,
                  active && isCue && styles.chipActiveInfo,
                  pressed && styles.pressed,
                ]}
              >
                {isCue ? (
                  <Music size={12} color={active ? colors.info : colors.mutedForeground} />
                ) : (
                  <Clapperboard size={12} color={active ? colors.primary : colors.mutedForeground} />
                )}
                <Text
                  style={[styles.chipLabel, active && styles.chipLabelActive]}
                  numberOfLines={1}
                >
                  {it.label}
                </Text>
                {it.sub ? <Text style={styles.chipSub}>{it.sub}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: 12 },
  videoWrap: { overflow: 'hidden', borderRadius: 0, backgroundColor: '#000' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActivePrimary: {
    borderColor: `${theme.colors.primary}99`,
    backgroundColor: `${theme.colors.primary}26`,
  },
  chipActiveInfo: {
    borderColor: `${theme.colors.info}99`,
    backgroundColor: `${theme.colors.info}26`,
  },
  pressed: { opacity: 0.7 },
  chipLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: theme.colors.foreground,
    maxWidth: 140,
  },
  chipLabelActive: { fontWeight: '600' },
  chipSub: { fontSize: 11, color: theme.colors.mutedForeground },
}));
