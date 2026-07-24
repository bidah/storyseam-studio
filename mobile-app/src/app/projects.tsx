import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
    <View className="flex-1 bg-background px-5 pt-6">
      <Eyebrow>Projects</Eyebrow>
      {projects.map((p) => (
        <Pressable
          key={p.id}
          className="flex-row items-center justify-between rounded-xl px-3 py-3.5 active:bg-secondary"
          onPress={() => activate(p)}
          onLongPress={() => {
            setRenaming(p);
            setName(p.name);
          }}
        >
          <Text className="flex-1 text-[15px] font-medium text-foreground" numberOfLines={1}>
            {p.name}
          </Text>
          {p.id === projectId ? <Check size={18} color={colors.primary} /> : null}
        </Pressable>
      ))}
      <View className="mt-4 gap-3">
        {creating || renaming ? (
          <View className="gap-2">
            <Input
              autoFocus
              placeholder={renaming ? 'Rename project' : 'New project name'}
              value={name}
              onChangeText={setName}
              onSubmitEditing={renaming ? rename : create}
            />
            <View className="flex-row gap-2">
              <Button
                className="flex-1"
                title={renaming ? 'Rename' : 'Create'}
                onPress={renaming ? rename : create}
              />
              <Button
                className="flex-1"
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
        <View className="flex-row items-center justify-center gap-1">
          <Pencil size={11} color={colors.subtleForeground} />
          <Text className="text-xs text-muted-foreground">Long-press a project to rename</Text>
        </View>
      </View>
    </View>
  );
}
