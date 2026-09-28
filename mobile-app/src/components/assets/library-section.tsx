import { providerEnabled } from '@/lib/providers';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Badge } from '@/components/ui/badge';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { useColors } from '@/lib/colors';
import { mediaUrl } from '@/lib/api';
import { useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import type { LibraryFolder } from './types';

// Library folder list: tap a folder card → push the in-folder image grid
// (a native screen, see app/(tabs)/assets/folder.tsx).

export function LibrarySection() {
  const colors = useColors();
  const { data, isPending, error, refetch } = useProjectResource<{
    folders: LibraryFolder[];
  }>('library');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const barInset = useTabBarScrollProps();

  const folders = data?.folders ?? [];

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;

  const totalSelected = folders.reduce(
    (a, f) => a + f.images.filter((i) => i.selected).length,
    0,
  );

  return (
    <FlatList
      {...barInset}
      data={folders}
      keyExtractor={(f) => f.folder}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />
      }
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        folders.length ? (
          <View style={styles.headerRow}>
            <Badge variant="outline" label={`${folders.length} folders`} />
            <Badge variant="success" label={`${totalSelected} selected`} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Empty
          title="Library is empty"
          hint={
            providerEnabled('higgsfield')
              ? 'Import your Higgsfield generations from the Import segment.'
              : 'Images you generate and save to the library appear here.'
          }
        />
      }
      renderItem={({ item: f }) => {
        const sel = f.images.filter((i) => i.selected).length;
        return (
          <BouncyPressable
            accessibilityLabel={`Open ${f.folder === '.' ? 'library root' : f.folder}`}
            style={styles.folderCard}
            onPress={() =>
              router.push({ pathname: '/(tabs)/assets/folder', params: { folder: f.folder } })
            }
          >
            <Image
              source={{ uri: mediaUrl(f.preview) }}
              style={styles.folderPreview}
              contentFit="cover"
            />
            <View style={styles.flex1}>
              <Text style={styles.folderName} numberOfLines={1}>
                {f.folder === '.' ? '(library root)' : f.folder}
              </Text>
              <Text style={styles.folderCount}>{f.count} images</Text>
            </View>
            {sel > 0 ? <Badge variant="success" label={`${sel}`} /> : null}
          </BouncyPressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 },
  headerRow: { marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  folderCard: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 10,
  },
  folderPreview: { width: 52, height: 52, borderRadius: 0 },
  folderName: { fontSize: 15, fontWeight: '500', color: theme.colors.foreground },
  folderCount: { fontSize: 12, color: theme.colors.mutedForeground },
}));
