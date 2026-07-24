import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Badge } from '@/components/ui/badge';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { mediaUrl } from '@/lib/api';
import { useProjectResource } from '@/lib/queries';
import type { LibraryFolder } from './types';

// Library folder list: tap a folder card → push the in-folder image grid
// (a native screen, see app/(tabs)/assets/folder.tsx).

export function LibrarySection() {
  const { data, isPending, error, refetch, isRefetching } = useProjectResource<{
    folders: LibraryFolder[];
  }>('library');

  const folders = data?.folders ?? [];

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;

  const totalSelected = folders.reduce(
    (a, f) => a + f.images.filter((i) => i.selected).length,
    0,
  );

  return (
    <FlatList
      data={folders}
      keyExtractor={(f) => f.folder}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#a1a1aa" />
      }
      contentContainerClassName="px-4 pb-8 pt-3"
      ListHeaderComponent={
        folders.length ? (
          <View className="mb-2 flex-row items-center gap-2">
            <Badge variant="outline" label={`${folders.length} folders`} />
            <Badge variant="success" label={`${totalSelected} selected`} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Empty
          title="Library is empty"
          hint="Import your Higgsfield generations from the Import segment."
        />
      }
      renderItem={({ item: f }) => {
        const sel = f.images.filter((i) => i.selected).length;
        return (
          <BouncyPressable
            accessibilityLabel={`Open ${f.folder === '.' ? 'library root' : f.folder}`}
            className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-2.5"
            onPress={() =>
              router.push({ pathname: '/(tabs)/assets/folder', params: { folder: f.folder } })
            }
          >
            <Image
              source={{ uri: mediaUrl(f.preview) }}
              style={{ width: 52, height: 52, borderRadius: 10 }}
              contentFit="cover"
            />
            <View className="flex-1">
              <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
                {f.folder === '.' ? '(library root)' : f.folder}
              </Text>
              <Text className="text-[12px] text-muted-foreground">{f.count} images</Text>
            </View>
            {sel > 0 ? <Badge variant="success" label={`${sel}`} /> : null}
          </BouncyPressable>
        );
      }}
    />
  );
}
