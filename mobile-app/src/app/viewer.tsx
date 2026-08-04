import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Full-screen media viewer. Params: url (absolute, already project-scoped via
// mediaUrl), kind ("image" | "video"), title?.
export default function ViewerModal() {
  const { url, kind, title } = useLocalSearchParams<{ url: string; kind?: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isVideo = kind === 'video';

  return (
    <View style={styles.root}>
      {isVideo ? (
        <VideoPlayer url={String(url)} width={width} height={height} />
      ) : (
        <Image
          source={{ uri: String(url) }}
          style={{ width, height }}
          contentFit="contain"
          transition={150}
        />
      )}
      <View style={[styles.bar, { top: insets.top + 4 }]}>
        <Text style={styles.title} numberOfLines={1}>
          {title || ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <X size={18} color="white" />
        </Pressable>
      </View>
    </View>
  );
}

function VideoPlayer({ url, width, height }: { url: string; width: number; height: number }) {
  const player = useVideoPlayer(url, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  title: {
    marginRight: 12,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.8)',
  },
  closeBtn: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  pressed: { opacity: 0.6 },
});
