import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { VideoView, useVideoPlayer } from 'expo-video';
import { mediaUrl } from '@/lib/api';

// One Director-plugin clip (a kept sitting, a Shot sheet take) in a plain
// expo-video card. `/director-media/…` paths go through mediaUrl, which adds
// the origin and ?projectId= (native players can't send the header).
export function StageVideo({ url, aspectRatio = 16 / 9 }: { url: string; aspectRatio?: number }) {
  const player = useVideoPlayer(mediaUrl(url) ?? null);
  return (
    <View style={styles.wrap}>
      <VideoView
        player={player}
        style={{ width: '100%', aspectRatio }}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderRadius: 0, backgroundColor: '#000' },
});
