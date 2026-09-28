import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { Check, FolderPlus, Pencil } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eyebrow } from '@/components/ui/card';
import { postJson, patchJson } from '@/lib/api';
import { useProjectStore } from '@/lib/project';
import { useProjects, type Project } from '@/lib/queries';
import { useColors } from '@/lib/colors';

// Project switcher sheet. Switching sets the store id (every request header +
// media URL follows), mirrors it server-side via /activate, and clears the
// query cache so no stale cross-project data survives.
export default function ProjectsSheet() {
  const { data, refetch } = useProjects();
  const { projectId, setProjectId } = useProjectStore();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const colors = useColors();

  const activate = async (p: Project) => {
    if (p.id === projectId) {
      router.back();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setProjectId(p.id);
    queryClient.clear();
    router.back();
    postJson(`/api/projects/${p.id}/activate`).catch(() => {});
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const res = await postJson<{ project: Project }>('/api/projects', { name: n });
      setName('');
      setCreating(false);
      await refetch();
      if (res?.project) activate(res.project);
    } catch (e: any) {
      toast.error(e?.message || 'Could not create project');
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const n = name.trim();
    if (!n || n === renaming.name) {
      setRenaming(null);
      return;
    }
    try {
      await patchJson(`/api/projects/${renaming.id}`, { name: n });
      setRenaming(null);
      setName('');
      refetch();
    } catch (e: any) {
      toast.error(e?.message || 'Rename failed');
    }
  };

  const projects = data?.projects || [];

  // Mirrors the model picker: a plain list of rows, no scroll container. A
  // FlatList here renders its scroll view over the sheet's own content (the
  // eyebrow ends up underneath it), and the project count never needs
  // virtualising.
  return (
    <View style={styles.root}>
      <Eyebrow>Projects</Eyebrow>
      {projects.map((p) => (
        <Pressable
          key={p.id}
          style={({ pressed }) => [styles.projectRow, pressed && styles.projectRowPressed]}
          onPress={() => activate(p)}
          onLongPress={() => {
            setRenaming(p);
            setName(p.name);
          }}
        >
          <Text style={styles.projectName} numberOfLines={1}>
            {p.name}
          </Text>
          {p.id === projectId ? <Check size={18} color={colors.primary} /> : null}
        </Pressable>
      ))}
      <View style={styles.footer}>
        {creating || renaming ? (
          <View style={styles.formGroup}>
            <Input
              autoFocus
              placeholder={renaming ? 'Rename project' : 'New project name'}
              value={name}
              onChangeText={setName}
              onSubmitEditing={renaming ? rename : create}
            />
            <View style={styles.formRow}>
              <Button
                style={styles.flex1}
                title={renaming ? 'Rename' : 'Create'}
                onPress={renaming ? rename : create}
              />
              <Button
                style={styles.flex1}
                variant="outline"
                title="Cancel"
                onPress={() => {
                  setCreating(false);
                  setRenaming(null);
                  setName('');
                }}
              />
            </View>
          </View>
        ) : (
          <Button variant="secondary" title="New project" onPress={() => setCreating(true)}>
            <FolderPlus size={16} color={colors.foreground} />
          </Button>
        )}
        <View style={styles.hintRow}>
          <Pencil size={11} color={colors.subtleForeground} />
          <Text style={styles.hintText}>Long-press a project to rename</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  projectRowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  projectName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  footer: {
    marginTop: 16,
    gap: 12,
  },
  formGroup: {
    gap: 8,
  },
  formRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flex1: {
    flex: 1,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.mutedForeground,
  },
}));
