import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Check, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Empty, Loading } from '@/components/ui/empty';
import { Eyebrow } from '@/components/ui/card';
import { mediaUrl } from '@/lib/api';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';

// Pick image(s) from the asset library. Params:
//   requestId — picker-bus id; resolves with string[] of `rel` keys (or null)
//   mode      — "single" (default) | "multi"
// Used by World (character sheet image) and Episode (bundle image refs).
export default function LibraryPickerSheet() {
  const { requestId, mode } = useLocalSearchParams<{ requestId?: string; mode?: string }>();
  const multi = mode === 'multi';
  const { data, isPending } = useProjectResource<any>('library');
  const [folder, setFolder] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  // Resolve null if the sheet is dismissed without a choice.
  useEffect(() => {
    return () => resolvePickerRequest(requestId, null);
  }, [requestId]);

  const folders = data?.folders || [];
  const current = useMemo(
    () => folders.find((f: any) => f.folder === folder) || null,
    [folders, folder],
  );

  const finish = (rels: string[]) => {
    resolvePickerRequest(requestId, rels);
    router.back();
  };

  if (isPending) return <Loading />;

  // A FlatList can't share a formSheet with sibling chrome: its scroll view
  // takes the sheet's bounds and draws over anything laid out beside it (the
  // eyebrow), dropping the wrapper's padding too. A plain scroll view that owns
  // its padding is the shape that behaves here (same as the character sheet).
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pb-8 pt-6">
      <Eyebrow>Pick from library</Eyebrow>
      {!current ? (
        <>
          {folders.length === 0 ? (
            <Empty title="Library is empty" hint="Import assets on the Assets tab first." />
          ) : (
            folders.map((item: any) => (
              <Pressable
                key={item.folder}
                className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-2.5 active:bg-secondary"
                onPress={() => setFolder(item.folder)}
              >
                <Image
                  source={{ uri: mediaUrl(item.preview) }}
                  style={{ width: 44, height: 44, borderRadius: 8 }}
                  contentFit="cover"
                />
                <View className="flex-1">
                  <Text className="text-[15px] font-medium text-foreground">{item.folder}</Text>
                  <Text className="text-[12px] text-muted-foreground">{item.count} images</Text>
                </View>
              </Pressable>
            ))
          )}
        </>
      ) : (
        <>
          <View className="mb-3 flex-row items-center justify-between">
            <Pressable
              className="flex-row items-center gap-1 active:opacity-60"
              onPress={() => setFolder(null)}
            >
              <ChevronLeft size={16} color="#a1a1aa" />
              <Text className="text-sm font-medium text-muted-foreground">{current.folder}</Text>
            </Pressable>
            {multi ? (
              <Button
                size="sm"
                title={`Use ${picked.length || ''}`.trim()}
                disabled={picked.length === 0}
                onPress={() => finish(picked)}
              />
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-2">
            {(current.images || []).map((item: any) => {
              const selected = picked.includes(item.rel);
              return (
                <Pressable
                  key={item.rel}
                  onPress={() => {
                    if (!multi) return finish([item.rel]);
                    setPicked((prev) =>
                      selected ? prev.filter((r) => r !== item.rel) : [...prev, item.rel],
                    );
                  }}
                >
                  <Image
                    source={{ uri: mediaUrl(item.thumb || item.url) }}
                    style={{ width: cell, height: cell, borderRadius: 10, opacity: multi && selected ? 0.7 : 1 }}
                    contentFit="cover"
                  />
                  {multi && selected ? (
                    <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-primary">
                      <Check size={14} color="white" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}
