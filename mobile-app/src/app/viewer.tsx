import { Pressable, Text, View, useWindowDimensions } from 'react-native';
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
    <View className="flex-1 bg-black">
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
      <View
        style={{ top: insets.top + 4 }}
        className="absolute left-0 right-0 flex-row items-center justify-between px-4"
      >
        <Text className="mr-3 flex-1 text-sm text-white/80" numberOfLines={1}>
          {title || ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="h-9 w-9 items-center justify-center rounded-full bg-white/15 active:opacity-60"
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
