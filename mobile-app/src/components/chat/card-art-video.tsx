import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';

// The artwork some suggestion cards wear in place of the mesh band: a short
// silent loop, filling the picture slot (see lib/card-art.ts for what lives
// where and why it's served rather than bundled).
//
// Lifted out of app/(tabs)/chat/index.tsx when the Story showcase arrived, so
// the landing deck and the full-screen showcase play the same loop through the
// same player rules rather than two copies that drift.
//
// It is DECORATION, so it behaves like decoration: no controls, no sound, no
// fullscreen, no PiP, and `pointerEvents="none"` so a tap on the picture is a
// tap on the card — the whole card is one button and the video must not eat the
// press. The mesh stays mounted UNDERNEATH rather than being swapped out, so the
// band is the card's colour from the first frame the screen paints; the loop
// fades up over it when the pixels arrive, and a device that's offline (or a
// file that 404s) simply keeps the gradient it already had.
//
// Playback is gated on tab FOCUS, not just mount: the deck runs to six cards and
// most of them have art now, so that's up to six AVPlayers decoding behind the
// Story tab — battery spent on something nobody is looking at. `useCaching` makes
// that cheap to resume — the file comes off disk on every launch after the first.
export function CardArtVideo({ uri, height }: { uri: string; height: number }) {
  const player = useVideoPlayer({ uri, useCaching: true }, (p) => {
    p.loop = true;
    p.muted = true;
    // Never take the audio session from whatever the author is listening to.
    // Muted alone doesn't guarantee that on iOS; this does.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // Focus, not mount: useFocusEffect's cleanup runs when the tab goes away, so
  // leaving the screen pauses every loop on it and coming back resumes them.
  //
  // The pause is guarded because this cleanup ALSO runs on unmount, and by then
  // the player may not exist: useVideoPlayer's own release is registered first
  // (it's the earlier hook), effect cleanups run in registration order, so the
  // native object is gone a beat before this line — and expo-video throws a
  // hard NotFoundException, i.e. a redbox, for a call on a released player
  // (seen on-sim 2026-07-30). A pause we lose on the way out costs nothing:
  // the player is being torn down anyway.
  useFocusEffect(
    useCallback(() => {
      player.play();
      return () => {
        try {
          player.pause();
        } catch {
          /* already released — see above */
        }
      };
    }, [player]),
  );

  return (
    <VideoView
      player={player}
      style={[StyleSheet.absoluteFill, { height }]}
      contentFit="cover"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsVideoFrameAnalysis={false}
      pointerEvents="none"
    />
  );
}
