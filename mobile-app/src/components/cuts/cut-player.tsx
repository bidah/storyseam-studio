import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { Clapperboard, Music } from 'lucide-react-native';
import { cn } from '@/lib/utils';
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
    <View className="gap-3">
      <View className="overflow-hidden rounded-xl bg-black">
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
                className={cn(
                  'flex-row items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 active:opacity-70',
                  active && !isCue && 'border-primary/60 bg-primary/15',
                  active && isCue && 'border-info/60 bg-info/15',
                )}
              >
                {isCue ? (
                  <Music size={12} color={active ? '#38bdf8' : '#a1a1aa'} />
                ) : (
                  <Clapperboard size={12} color={active ? '#10b981' : '#a1a1aa'} />
                )}
                <Text
                  className={cn('text-xs font-medium text-foreground', active && 'font-semibold')}
                  numberOfLines={1}
                  style={{ maxWidth: 140 }}
                >
                  {it.label}
                </Text>
                {it.sub ? <Text className="text-[11px] text-muted-foreground">{it.sub}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}
