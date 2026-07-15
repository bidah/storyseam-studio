import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Check, KeyRound } from 'lucide-react-native';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { ApiError, mediaUrl, postJson } from '@/lib/api';
import { createPickerRequest } from '@/lib/picker-bus';
import { useHiggsfieldImages, useInvalidate, useProjectResource } from '@/lib/queries';
import type { HfItem, LibraryFolder } from './types';

// Import from Higgsfield: infinite 3-column grid of the user's completed image
// generations. Tap an un-imported tile → pick a destination folder (action
// sheet) → POST /api/higgsfield/import. Imported tiles get an emerald ring and
// open the viewer instead; long-press removes the imported copy.

// Basename of a Higgsfield delivery URL ("…/hf_2026…_<id>.png") — un-renamed
// imports keep this file name, so a library match means "already imported".
function urlBasename(u: string) {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}

export function ImportSection() {
  const q = useHiggsfieldImages();
  const lib = useProjectResource<{ folders: LibraryFolder[] }>('library');
  const invalidate = useInvalidate();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 16 * 2 - 8 * 2) / 3);

  const [imported, setImported] = useState<Record<string, string>>({}); // hf id -> rel (this session)
  const [busyId, setBusyId] = useState<string | null>(null);

  const items: HfItem[] = useMemo(
    () => (q.data?.pages ?? []).flatMap((p: any) => p?.items ?? []),
    [q.data],
  );

  const libraryByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of lib.data?.folders ?? []) for (const im of f.images) m.set(im.name, im.rel);
    return m;
  }, [lib.data]);

  const doImport = async (item: HfItem, folder: string) => {
    setBusyId(item.id);
    try {
      const j = await postJson<{ rel: string }>('/api/higgsfield/import', {
        rawUrl: item.rawUrl,
        minUrl: item.minUrl,
        folder,
      });
      setImported((m) => ({ ...m, [item.id]: j.rel }));
      invalidate('library');
      toast.success(`Imported to ${folder === '.' ? 'library root' : folder}`);
    } catch (e: any) {
      toast.error(`Import failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  };

  // Pick a destination folder through the formSheet (src/app/import-folder.tsx),
  // which resolves the chosen (or freshly typed) folder name via the picker bus.
  const chooseDestination = async (item: HfItem) => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/import-folder', params: { requestId } });
    const folder = (await promise) as string | null;
    if (folder) doImport(item, folder);
  };

  const removeImported = (item: HfItem, rel: string) => {
    Alert.alert(
      'Remove from library?',
      `"${rel}" will be deleted from the asset library (and dropped from final_selection if selected). The Higgsfield generation itself is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await postJson('/api/library/remove', { rel });
              setImported((m) => {
                const next = { ...m };
                delete next[item.id];
                return next;
              });
              invalidate('library');
              toast.success('Removed');
            } catch (e: any) {
              toast.error(`Remove failed: ${e?.message || e}`);
            }
          },
        },
      ],
    );
  };

  const openViewer = (item: HfItem) =>
    router.push({
      pathname: '/viewer',
      params: { url: item.rawUrl, kind: 'image', title: item.prompt || item.model || item.id },
    });

  const showMenu = (item: HfItem, inLibrary: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (Platform.OS !== 'ios') {
      if (inLibrary) removeImported(item, inLibrary);
      else chooseDestination(item);
      return;
    }
    const options = inLibrary
      ? ['View', 'Remove from library', 'Cancel']
      : ['View', 'Import to library', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.prompt || item.model || item.id,
        options,
        cancelButtonIndex: 2,
        ...(inLibrary ? { destructiveButtonIndex: 1 } : {}),
      },
      (i) => {
        if (i === 0) openViewer(item);
        else if (i === 1) {
          if (inLibrary) removeImported(item, inLibrary);
          else chooseDestination(item);
        }
      },
    );
  };

  // Expired / missing Higgsfield credential — the web app shows an in-place
  // OAuth card; on mobile the re-connect happens through the chat agent.
  const err: any = q.error;
  const needsAuth =
    (err instanceof ApiError && err.status === 401) || err?.message === 'no_higgsfield_token';
  if (needsAuth) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <KeyRound size={22} color="#a1a1aa" />
        <Text className="text-center text-sm text-muted-foreground">
          Your Higgsfield session expired. Ask the agent in the Chat tab to re-connect Higgsfield,
          then pull to refresh here.
        </Text>
      </View>
    );
  }

  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorNote message={String(err?.message || q.error)} onRetry={() => q.refetch()} />;

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.id}
      numColumns={3}
      columnWrapperClassName="gap-2 px-4"
      contentContainerClassName="gap-2 pb-8 pt-3"
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => q.refetch()}
          tintColor="#a1a1aa"
        />
      }
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Empty
          title="No generations found"
          hint="No completed image generations on your Higgsfield account."
        />
      }
      ListFooterComponent={
        q.isFetchingNextPage ? (
          <View className="items-center py-4">
            <ActivityIndicator />
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const inLibrary = imported[item.id] || libraryByName.get(urlBasename(item.rawUrl)) || null;
        const busy = busyId === item.id;
        return (
          <Pressable
            onPress={() => (inLibrary ? openViewer(item) : chooseDestination(item))}
            onLongPress={() => showMenu(item, inLibrary)}
            disabled={busy}
            style={{ width: cell, opacity: busy ? 0.5 : 1 }}
          >
            <View
              className={
                inLibrary
                  ? 'overflow-hidden rounded-xl border-2 border-success'
                  : 'overflow-hidden rounded-xl border border-border'
              }
              style={{ width: cell, height: cell }}
            >
              <Image
                source={{ uri: mediaUrl(item.thumb) || item.minUrl }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={100}
              />
              {busy ? (
                <View className="absolute inset-0 items-center justify-center">
                  <ActivityIndicator />
                </View>
              ) : null}
              {inLibrary ? (
                <View className="absolute right-1.5 top-1.5 h-5 w-5 items-center justify-center rounded-full bg-success">
                  <Check size={12} color="white" />
                </View>
              ) : null}
            </View>
            <Text className="mt-1 text-[11px] text-muted-foreground" numberOfLines={1}>
              {item.prompt || item.model}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
