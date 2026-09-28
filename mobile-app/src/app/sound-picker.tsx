import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { Heart, Mic } from 'lucide-react-native';
import { Empty, Loading } from '@/components/ui/empty';
import { Eyebrow } from '@/components/ui/card';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';
import { useColors } from '@/lib/colors';

// Pick a voice take from the Sound Studio (used to attach a voice to a World
// character). Resolves { trackId, v, name, url } or null. Prefers liked takes;
// falls back to any ready voice-kind version.
export default function SoundPickerSheet() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { data, isPending } = useProjectResource<any>('sounds');
  const colors = useColors();

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
    <View style={styles.root}>
      <Eyebrow>Attach a voice</Eyebrow>
      <FlatList
        data={takes}
        keyExtractor={(t) => `${t.trackId}:${t.v}`}
        ListEmptyComponent={
          <Empty title="No ready voice takes" hint="Render voice tracks in the Sound Studio first." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
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
            <View style={styles.avatar}>
              <Mic size={16} color={colors.mutedForeground} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {item.trackName}
              </Text>
              <Text style={styles.subtitle}>
                {item.name} · v{item.v}
              </Text>
            </View>
            {item.liked ? <Heart size={16} color={colors.primary} fill={colors.primary} /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  row: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  rowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  avatar: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
}));
