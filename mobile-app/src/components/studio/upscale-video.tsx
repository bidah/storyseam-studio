import { useEffect } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { mediaUrl } from '@/lib/api';

// One inline 16:9 player for a studio file (a sitting, a scored film, an
// upscale). `onHeight` reports the source's pixel height once the video track
// is known — the Topaz upscaler needs it to pick its factor (the web reads it
// off <video>.videoHeight).
export function InlineVideo({
  url,
  onHeight,
  autoPlay = false,
}: {
  url: string | null | undefined;
  onHeight?: (h: number) => void;
  autoPlay?: boolean;
}) {
  const src = mediaUrl(url ?? null) ?? null;
  const player = useVideoPlayer(src, (p) => {
    if (autoPlay) p.play();
  });
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    const h = videoTrack?.size?.height;
    if (h && onHeight) onHeight(h);
  });
  useEffect(() => {
    const h = player.videoTrack?.size?.height;
    if (h && onHeight) onHeight(h);
  }, [player, onHeight]);
  if (!src) return null;
  return (
    <View style={styles.frame}>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  video: { width: '100%', height: '100%' },
}));
