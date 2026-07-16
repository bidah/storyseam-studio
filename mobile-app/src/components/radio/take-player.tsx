// Voice-take preview — the mobile stand-in for the web Radio tab's
// `<audio controls>` on every line and casting row.
//
// The web can afford one <audio> element per line; a phone cannot afford one
// expo-audio player per line (a scene is a dozen lines, an episode many more,
// and each player holds a native decoder). So ONE player lives at the screen
// root and every row asks it to play a url — which also gives the behavior you
// want on a phone anyway: starting a take stops the previous one.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { mediaUrl } from '@/lib/api';

type TakeAudio = {
  /** The url currently loaded, or null. */
  current: string | null;
  playing: boolean;
  toggle: (url: string) => void;
};

const TakeAudioContext = createContext<TakeAudio | null>(null);

export function TakeAudioProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

  const toggle = useCallback(
    (url: string) => {
      const uri = mediaUrl(url);
      if (!uri) return;
      try {
        if (current === uri) {
          if (status.playing) player.pause();
          else {
            // expo-audio parks at the end instead of rewinding, so a finished
            // take would otherwise no-op on the second tap.
            if (status.duration > 0 && status.currentTime >= status.duration - 0.05) {
              player.seekTo(0);
            }
            player.play();
          }
          return;
        }
        player.replace({ uri });
        setCurrent(uri);
        player.play();
      } catch {
        /* a dropped source shouldn't take the screen down */
      }
    },
    [player, current, status.playing, status.duration, status.currentTime],
  );

  const value = useMemo<TakeAudio>(
    () => ({ current, playing: !!status.playing, toggle }),
    [current, status.playing, toggle],
  );
  return <TakeAudioContext.Provider value={value}>{children}</TakeAudioContext.Provider>;
}

/** Play/pause button for one take url. Renders nothing without a url. */
export function TakePlayButton({ url, label }: { url: string | null; label: string }) {
  const audio = useContext(TakeAudioContext);
  if (!url || !audio) return null;
  const isCurrent = audio.current === mediaUrl(url);
  const isPlaying = isCurrent && audio.playing;
  return (
    <Button
      size="icon"
      variant="ghost"
      accessibilityLabel={isPlaying ? `Pause ${label}` : `Play ${label}`}
      onPress={() => audio.toggle(url)}
    >
      {isPlaying ? <Pause size={16} color="#10b981" /> : <Play size={16} color="#fafafa" />}
    </Button>
  );
}
