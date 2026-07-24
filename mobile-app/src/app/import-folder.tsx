import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Folder, FolderRoot } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Loading } from '@/components/ui/empty';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';
import { useColors } from '@/lib/colors';
import type { LibraryFolder } from '@/components/assets/types';

// "Add to library — pick a folder" as a formSheet (replaces the iOS action
// sheet / Android Alert in import-section.tsx). Resolves the chosen folder name
// (or a freshly typed one) back to the caller via the picker bus, or null on
// dismiss.
export default function ImportFolderSheet() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { data, isPending } = useProjectResource<{ folders: LibraryFolder[] }>('library');
  const [name, setName] = useState('higgsfield');
  const colors = useColors();

  // Dismiss without picking → resolve null (no-op if already resolved).
  useEffect(() => {
    return () => resolvePickerRequest(requestId, null);
  }, [requestId]);

  const pick = (folder: string) => {
    resolvePickerRequest(requestId, folder);
    router.back();
  };

  if (isPending) return <Loading />;

  const folders = data?.folders ?? [];
  const trimmed = name.trim();

  return (
    // A list can't share a formSheet with sibling chrome — its scroll view takes
    // the sheet's bounds and draws over anything beside it (here the eyebrow
    // above and the new-folder form below). One scroll view owns the whole
    // sheet instead, so the form scrolls with the list rather than staying
    // pinned to the bottom.
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pb-6 pt-5"
      keyboardShouldPersistTaps="handled"
    >
      <Eyebrow>Add to library</Eyebrow>
      <Text className="mb-3 mt-0.5 text-[13px] text-muted-foreground">
        Pick a destination folder for this image.
      </Text>

      {folders.map((item) => {
        const root = item.folder === '.';
        return (
          <Pressable
            key={item.folder}
            className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-secondary"
            onPress={() => pick(item.folder)}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-secondary">
              {root ? <FolderRoot size={16} color={colors.mutedForeground} /> : <Folder size={16} color={colors.mutedForeground} />}
            </View>
            <Text className="flex-1 text-[15px] font-medium text-foreground" numberOfLines={1}>
              {root ? '(library root)' : item.folder}
            </Text>
            <Text className="text-[12px] text-muted-foreground">{item.count}</Text>
          </Pressable>
        );
      })}

      <View className="mt-3 gap-2 border-t border-border pt-3">
        <Eyebrow>New folder</Eyebrow>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Folder name"
          placeholderTextColor={colors.subtleForeground}
          autoCapitalize="none"
          className="rounded-lg border border-border bg-card px-3 py-2.5 text-[15px] text-foreground"
        />
        <View className="mt-1 flex-row gap-2 pb-2">
          <Button
            variant="secondary"
            title="Cancel"
            className="flex-1"
            onPress={() => {
              resolvePickerRequest(requestId, null);
              router.back();
            }}
          />
          <Button
            title="New folder"
            className="flex-1"
            disabled={!trimmed}
            onPress={() => pick(trimmed)}
          />
        </View>
      </View>
    </ScrollView>
  );
}
