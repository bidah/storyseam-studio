import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
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

  return (
    <View className="flex-1 bg-background px-4 pt-6">
      {!current ? (
        <>
          <Eyebrow>Pick from library</Eyebrow>
          <FlatList
            data={folders}
            keyExtractor={(f: any) => f.folder}
            ListEmptyComponent={<Empty title="Library is empty" hint="Import assets on the Assets tab first." />}
            renderItem={({ item }: any) => (
              <Pressable
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
            )}
          />
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
          <FlatList
            data={current.images || []}
            numColumns={3}
            keyExtractor={(img: any) => img.rel}
            columnWrapperClassName="gap-2"
            contentContainerClassName="gap-2 pb-8"
            renderItem={({ item }: any) => {
              const selected = picked.includes(item.rel);
              return (
                <Pressable
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
            }}
          />
        </>
      )}
    </View>
  );
}
