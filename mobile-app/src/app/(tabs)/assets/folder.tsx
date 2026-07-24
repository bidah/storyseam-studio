import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Check } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';
import { mediaUrl, postJson } from '@/lib/api';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import type { LibraryFolder, LibraryImage } from '@/components/assets/types';

// In-folder image grid — pushed from the Library folder list as its own native
// screen (folder name in the native header + native back button). Tap a tile =
// full-screen Galeria viewer; long-press = context menu (toggle
// final_selection / rename / delete). Reads the same cached `library` resource
// the list does, so opening is instant.

export default function AssetFolderScreen() {
  const colors = useColors();
  const scheme = useEffectiveScheme();
  const { folder } = useLocalSearchParams<{ folder: string }>();
  const id = String(folder ?? '');
  const { data, isPending, error, refetch } = useProjectResource<{
    folders: LibraryFolder[];
  }>('library');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const invalidate = useInvalidate();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  const current = data?.folders.find((f) => f.folder === id) || null;
  const title = id === '.' ? '(library root)' : id;
  const screen = <Stack.Screen options={{ title }} />;

  const toggle = async (im: LibraryImage) => {
    try {
      await postJson('/api/library/toggle', { rel: im.rel });
      invalidate('library');
    } catch (e: any) {
      toast.error(`Toggle failed: ${e?.message || e}`);
    }
  };

  const rename = (im: LibraryImage) => {
    if (Platform.OS !== 'ios') {
      toast.error('Rename is available on iOS only for now');
      return;
    }
    Alert.prompt(
      'Rename asset',
      'Name what the image shows (e.g. elara_courtroom_closeup) so Episode auto-assign can match it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: async (name?: string) => {
            const next = name?.trim();
            if (!next || next === im.name) return;
            try {
              await postJson('/api/library/rename', { rel: im.rel, name: next });
              invalidate('library');
              toast.success('Renamed');
            } catch (e: any) {
              toast.error(`Rename failed: ${e?.message || e}`);
            }
          },
        },
      ],
      'plain-text',
      im.name,
    );
  };

  const confirmDelete = (im: LibraryImage) => {
    Alert.alert(
      'Delete from library?',
      `"${im.name}" will be permanently deleted from the asset library${
        im.selected ? ', final_selection, and any shots it was assigned to' : ''
      }.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await postJson('/api/library/remove', { rel: im.rel });
              invalidate('library');
              toast.success('Deleted');
            } catch (e: any) {
              toast.error(`Delete failed: ${e?.message || e}`);
            }
          },
        },
      ],
    );
  };

  const showMenu = (im: LibraryImage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const toggleLabel = im.selected ? 'Remove from final selection' : 'Add to final selection';
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: im.name,
          options: [toggleLabel, 'Rename', 'Delete', 'Cancel'],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 3,
        },
        (i) => {
          if (i === 0) toggle(im);
          else if (i === 1) rename(im);
          else if (i === 2) confirmDelete(im);
        },
      );
    } else {
      Alert.alert(im.name, undefined, [
        { text: toggleLabel, onPress: () => toggle(im) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(im) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const refresh = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />
  );

  if (isPending) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <Loading />
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />
      </View>
    );
  }
  if (!current) {
    return (
      <View className="flex-1 bg-background">
        {screen}
        <Empty title="Folder not found" hint={`No folder "${title}" in the library.`} />
      </View>
    );
  }

  const selCount = current.images.filter((i) => i.selected).length;
  // Full-res URLs (grid order) for the Galeria viewer — tapping a tile opens a
  // native, swipeable full-screen gallery with a shared-element transition.
  const galleryUrls = current.images.map((im) => mediaUrl(im.url) ?? '');

  return (
    <Galeria urls={galleryUrls} theme={scheme}>
      <View className="flex-1 bg-background">
        {screen}
        <FlatList
          data={current.images}
          keyExtractor={(im) => im.rel}
          numColumns={3}
          refreshControl={refresh}
          columnWrapperClassName="gap-2 px-4"
          contentContainerClassName="gap-2 pb-8 pt-3"
          ListHeaderComponent={
            <View className="mb-1 flex-row items-center gap-2 px-4">
              <Badge variant="outline" label={`${current.count} images`} />
              {selCount > 0 ? <Badge variant="success" label={`${selCount} selected`} /> : null}
            </View>
          }
          ListEmptyComponent={<Empty title="No images in this folder" />}
          renderItem={({ item: im, index }) => (
            <View style={{ width: cell }}>
              <View
                className={
                  im.selected
                    ? 'overflow-hidden rounded-xl border-2 border-success'
                    : 'overflow-hidden rounded-xl border border-border'
                }
                style={{ width: cell, height: cell }}
              >
                <Galeria.Image index={index} onLongPress={() => showMenu(im)} style={{ width: cell, height: cell }}>
                  <Image
                    source={{ uri: mediaUrl(im.thumb || im.url) }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={100}
                  />
                </Galeria.Image>
                {im.selected ? (
                  <View className="absolute right-1.5 top-1.5 h-5 w-5 items-center justify-center rounded-full bg-success">
                    <Check size={12} color="white" />
                  </View>
                ) : null}
              </View>
              <Text className="mt-1 text-[11px] text-muted-foreground" numberOfLines={1}>
                {im.name}
              </Text>
            </View>
          )}
        />
      </View>
    </Galeria>
  );
}
