import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Check, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Empty, Loading } from '@/components/ui/empty';
import { Eyebrow } from '@/components/ui/card';
import { mediaUrl } from '@/lib/api';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';
import { useColors } from '@/lib/colors';

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
  const colors = useColors();

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
    <ScrollView style={styles.root} contentContainerStyle={styles.contentContainer}>
      <Eyebrow>Pick from library</Eyebrow>
      {!current ? (
        <>
          {folders.length === 0 ? (
            <Empty title="Library is empty" hint="Import assets on the Assets tab first." />
          ) : (
            folders.map((item: any) => (
              <Pressable
                key={item.folder}
                style={({ pressed }) => [styles.folderRow, pressed && styles.folderRowPressed]}
                onPress={() => setFolder(item.folder)}
              >
                <Image
                  source={{ uri: mediaUrl(item.preview) }}
                  style={{ width: 44, height: 44, borderRadius: 8 }}
                  contentFit="cover"
                />
                <View style={styles.folderInfo}>
                  <Text style={styles.folderName}>{item.folder}</Text>
                  <Text style={styles.folderCount}>{item.count} images</Text>
                </View>
              </Pressable>
            ))
          )}
        </>
      ) : (
        <>
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => setFolder(null)}
            >
              <ChevronLeft size={16} color={colors.mutedForeground} />
              <Text style={styles.backLabel}>{current.folder}</Text>
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
          <View style={styles.grid}>
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
                    <View style={styles.checkBadge}>
                      <Check size={14} color={colors.primaryForeground} />
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

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 24,
  },
  folderRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 10,
  },
  folderRowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  folderCount: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  headerRow: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: theme.colors.mutedForeground,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkBadge: {
    position: 'absolute',
    right: 6,
    top: 6,
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
}));
