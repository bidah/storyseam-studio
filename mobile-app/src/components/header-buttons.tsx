import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { NativeStackNavigationOptions } from 'expo-router/build/react-navigation/native-stack/types';
import { ChevronDown, RefreshCw, Settings2 } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '@/lib/project';
import { useProjects } from '@/lib/queries';

// Shared native-header building blocks. Each tab nests its own Stack (so it gets
// an expo-router native header); these render the controls that used to live in
// the custom ScreenHeader — project switcher (left) + refresh/settings (right).

const MUTED = '#a1a1aa';
const BG = '#0a0a0b';
const FG = '#fafafa';

// Project switcher pill — headerLeft on every tab. Opens the projects sheet.
export function ProjectSwitcherButton() {
  const projectId = useProjectStore((s) => s.projectId);
  const { data } = useProjects();
  const project = data?.projects?.find((p) => p.id === projectId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Switch project"
      className="flex-row items-center gap-1 rounded-full bg-secondary px-3 py-1.5 active:opacity-70"
      onPress={() => router.push('/projects')}
    >
      <Text className="max-w-36 text-[13px] font-semibold text-foreground" numberOfLines={1}>
        {project?.name || 'Project'}
      </Text>
      <ChevronDown size={14} color={MUTED} />
    </Pressable>
  );
}

// Refresh + settings — headerRight on the content tabs. Refresh invalidates the
// whole project scope (+ account), matching the old ScreenHeader behaviour.
export function TabHeaderActions() {
  const projectId = useProjectStore((s) => s.projectId);
  const queryClient = useQueryClient();
  return (
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
        <RefreshCw size={17} color={MUTED} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        onPress={() => router.push('/settings')}
      >
        <Settings2 size={18} color={MUTED} />
      </Pressable>
    </View>
  );
}

// Shared dark-theme native header styling (colors, large iOS title). Spread into
// each tab's Stack screenOptions; per-screen options add title/headerLeft/Right.
export const HEADER_BASE = {
  headerShown: true,
  headerLargeTitle: true,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: BG },
  headerLargeStyle: { backgroundColor: BG },
  headerTintColor: FG,
  headerTitleStyle: { color: FG },
  headerLargeTitleStyle: { color: FG },
  contentStyle: { backgroundColor: BG },
} satisfies NativeStackNavigationOptions;

// Full options for a content tab's root screen: shared styling + title +
// project switcher (left) + refresh/settings (right).
export function tabHeaderOptions(title: string): NativeStackNavigationOptions {
  return {
    ...HEADER_BASE,
    title,
    headerLeft: () => <ProjectSwitcherButton />,
    headerRight: () => <TabHeaderActions />,
  };
}
