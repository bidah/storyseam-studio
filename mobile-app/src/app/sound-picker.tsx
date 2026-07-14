import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Heart, Mic } from 'lucide-react-native';
import { Empty, Loading } from '@/components/ui/empty';
import { Eyebrow } from '@/components/ui/card';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';

// Pick a voice take from the Sound Studio (used to attach a voice to a World
// character). Resolves { trackId, v, name, url } or null. Prefers liked takes;
// falls back to any ready voice-kind version.
export default function SoundPickerSheet() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { data, isPending } = useProjectResource<any>('sounds');

  useEffect(() => {
    return () => resolvePickerRequest(requestId, null);
  }, [requestId]);

  const takes = useMemo(() => {
    const out: any[] = [];
    for (const t of data?.tracks || []) {
      if (t.kind && t.kind !== 'voice') continue;
      for (const v of t.versions || []) {
        if (v.status !== 'ready' || !v.url) continue;
        out.push({
          trackId: t.id,
          trackName: t.name || t.id,
          v: v.v,
          name: v.name || `v${v.v}`,
          url: v.url,
          liked: !!v.liked,
        });
      }
    }
    // Liked first, then most recent version.
    return out.sort((a, b) => Number(b.liked) - Number(a.liked) || b.v - a.v);
  }, [data]);

  if (isPending) return <Loading />;

  return (
    <View className="flex-1 bg-background px-4 pt-6">
      <Eyebrow>Attach a voice</Eyebrow>
      <FlatList
        data={takes}
        keyExtractor={(t) => `${t.trackId}:${t.v}`}
        ListEmptyComponent={
          <Empty title="No ready voice takes" hint="Render voice tracks in the Sound Studio first." />
        }
        renderItem={({ item }) => (
          <Pressable
            className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-secondary"
            onPress={() => {
              resolvePickerRequest(requestId, {
                trackId: item.trackId,
                v: item.v,
                name: item.name,
                url: item.url,
              });
              router.back();
            }}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-secondary">
              <Mic size={16} color="#a1a1aa" />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
                {item.trackName}
              </Text>
              <Text className="text-[12px] text-muted-foreground">
                {item.name} · v{item.v}
              </Text>
            </View>
            {item.liked ? <Heart size={16} color="#10b981" fill="#10b981" /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
