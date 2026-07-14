import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronDown, RefreshCw, Settings2 } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/lib/project';
import { useProjects } from '@/lib/queries';

// Shared per-tab header: project switcher pill · screen title · refresh · settings.
// (NativeTabs screens don't get a stack header, so each tab renders this.)
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const projectId = useProjectStore((s) => s.projectId);
  const { data } = useProjects();
  const project = data?.projects?.find((p) => p.id === projectId);
  const queryClient = useQueryClient();

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="border-b border-border bg-background px-4 pb-2"
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch project"
          className="flex-row items-center gap-1 rounded-full bg-secondary px-3 py-1.5 active:opacity-70"
          onPress={() => router.push('/projects')}
        >
          <Text className="max-w-40 text-[13px] font-semibold text-foreground" numberOfLines={1}>
            {project?.name || 'Project'}
          </Text>
          <ChevronDown size={14} color="#a1a1aa" />
        </Pressable>
        <View className="flex-row items-center gap-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={() => {
              if (projectId) queryClient.invalidateQueries({ queryKey: [projectId] });
              queryClient.invalidateQueries({ queryKey: ['account'] });
            }}
          >
            <RefreshCw size={17} color="#a1a1aa" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            onPress={() => router.push('/settings')}
          >
            <Settings2 size={18} color="#a1a1aa" />
          </Pressable>
        </View>
      </View>
      <Text className="mt-2 text-[26px] font-bold tracking-tight text-foreground">{title}</Text>
    </View>
  );
}
