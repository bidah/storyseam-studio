import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Folder, FolderRoot } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Loading } from '@/components/ui/empty';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useProjectResource } from '@/lib/queries';
import type { LibraryFolder } from '@/components/assets/types';

// "Add to library — pick a folder" as a formSheet (replaces the iOS action
// sheet / Android Alert in import-section.tsx). Resolves the chosen folder name
// (or a freshly typed one) back to the caller via the picker bus, or null on
// dismiss.
export default function ImportFolderSheet() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { data, isPending } = useProjectResource<{ folders: LibraryFolder[] }>('library');
  const [name, setName] = useState('higgsfield');

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
    <View className="flex-1 bg-background px-4 pt-5">
      <Eyebrow>Add to library</Eyebrow>
      <Text className="mb-3 mt-0.5 text-[13px] text-muted-foreground">
        Pick a destination folder for this image.
      </Text>

      <FlatList
        data={folders}
        keyExtractor={(f) => f.folder}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const root = item.folder === '.';
          return (
            <Pressable
              className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-card p-3 active:bg-secondary"
              onPress={() => pick(item.folder)}
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-secondary">
                {root ? <FolderRoot size={16} color="#a1a1aa" /> : <Folder size={16} color="#a1a1aa" />}
              </View>
              <Text className="flex-1 text-[15px] font-medium text-foreground" numberOfLines={1}>
                {root ? '(library root)' : item.folder}
              </Text>
              <Text className="text-[12px] text-muted-foreground">{item.count}</Text>
            </Pressable>
          );
        }}
      />

      <View className="gap-2 border-t border-border pt-3">
        <Eyebrow>New folder</Eyebrow>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Folder name"
          placeholderTextColor="#71717a"
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
    </View>
  );
}
