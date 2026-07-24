import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Check, ChevronLeft } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { mediaUrl, postJson } from '@/lib/api';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import type { LibraryFolder, LibraryImage } from './types';

// Library: folder cards → in-folder 3-column image grid. Tap = viewer,
// long-press = context menu (toggle final_selection / rename / delete).

export function LibrarySection() {
  const { data, isPending, error, refetch, isRefetching } = useProjectResource<{
    folders: LibraryFolder[];
  }>('library');
  const invalidate = useInvalidate();
  const [active, setActive] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  const folders = data?.folders ?? [];
  const current = folders.find((f) => f.folder === active) || null;

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

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;

  const refresh = (
    <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#a1a1aa" />
  );

  // ---- In-folder image grid -------------------------------------------------
  if (current) {
    const selCount = current.images.filter((i) => i.selected).length;
    // Full-res URLs (grid order) for the Galeria viewer — tapping a tile opens
    // a native, swipeable full-screen gallery with a shared-element transition.
    // The tiles themselves keep showing thumbs; Galeria morphs thumb → full.
    const galleryUrls = current.images.map((im) => mediaUrl(im.url) ?? '');
    return (
      <Galeria urls={galleryUrls} theme="dark">
      <View className="flex-1">
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to all folders"
            className="flex-row items-center gap-0.5 active:opacity-60"
            onPress={() => setActive(null)}
          >
            <ChevronLeft size={18} color="#a1a1aa" />
            <Text className="text-sm font-medium text-muted-foreground">Folders</Text>
          </Pressable>
          <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
            {current.folder === '.' ? '(library root)' : current.folder}
          </Text>
          <Badge variant="outline" label={`${current.count}`} />
          {selCount > 0 ? <Badge variant="success" label={`${selCount} selected`} /> : null}
        </View>
        <FlatList
          data={current.images}
          keyExtractor={(im) => im.rel}
          numColumns={3}
          refreshControl={refresh}
          columnWrapperClassName="gap-2 px-4"
          contentContainerClassName="gap-2 pb-8"
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
                <Galeria.Image
                  index={index}
                  onLongPress={() => showMenu(im)}
                  style={{ width: cell, height: cell }}
                >
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

  // ---- Folder list ----------------------------------------------------------
  const totalSelected = folders.reduce(
    (a, f) => a + f.images.filter((i) => i.selected).length,
    0,
  );
  return (
    <FlatList
      data={folders}
      keyExtractor={(f) => f.folder}
      refreshControl={refresh}
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
          <Pressable
            className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-2.5 active:bg-secondary"
            onPress={() => setActive(f.folder)}
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
          </Pressable>
        );
      }}
    />
  );
}
