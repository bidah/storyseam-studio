import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
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
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Eyebrow>Add to library</Eyebrow>
      <Text style={styles.subtitle}>
        Pick a destination folder for this image.
      </Text>

      {folders.map((item) => {
        const root = item.folder === '.';
        return (
          <Pressable
            key={item.folder}
            style={({ pressed }) => [styles.folderRow, pressed && styles.folderRowPressed]}
            onPress={() => pick(item.folder)}
          >
            <View style={styles.folderIcon}>
              {root ? <FolderRoot size={16} color={colors.mutedForeground} /> : <Folder size={16} color={colors.mutedForeground} />}
            </View>
            <Text style={styles.folderName} numberOfLines={1}>
              {root ? '(library root)' : item.folder}
            </Text>
            <Text style={styles.folderCount}>{item.count}</Text>
          </Pressable>
        );
      })}

      <View style={styles.newFolderSection}>
        <Eyebrow>New folder</Eyebrow>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Folder name"
          placeholderTextColor={colors.subtleForeground}
          autoCapitalize="none"
          style={styles.input}
        />
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            title="Cancel"
            style={styles.buttonFlex}
            onPress={() => {
              resolvePickerRequest(requestId, null);
              router.back();
            }}
          />
          <Button
            title="New folder"
            style={styles.buttonFlex}
            disabled={!trimmed}
            onPress={() => pick(trimmed)}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 20,
  },
  subtitle: {
    marginBottom: 12,
    marginTop: 2,
    fontSize: 13,
    color: theme.colors.mutedForeground,
  },
  folderRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  folderRowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  folderIcon: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  folderName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  folderCount: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  newFolderSection: {
    marginTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
  },
  input: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.foreground,
  },
  buttonRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
  },
  buttonFlex: {
    flex: 1,
  },
}));
