import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, FolderKanban, Settings2 } from 'lucide-react-native';
import { closeDrawer, useDrawerStore } from '@/lib/drawer';
import { useProjectStore } from '@/lib/project';
import { useProjects } from '@/lib/queries';

const MUTED = '#a1a1aa';
const FG = '#fafafa';

// Left slide-in navigation drawer, mounted once at the root so it overlays the
// native tab headers. Built purely from libs already in the binary (reanimated +
// safe-area) so it ships as an OTA update — no native rebuild. Opened by the
// burger header item; holds the current project (opens the project selector) and
// Settings (moved out of the top-right header) per TOO-11.

// Row inside the drawer: leading icon + label, optional trailing chevron.
function DrawerRow({
  icon,
  label,
  sublabel,
  onPress,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-secondary"
    >
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-secondary">{icon}</View>
      <View className="flex-1">
        {sublabel ? (
          <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {sublabel}
          </Text>
        ) : null}
        <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {label}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}

export function AppDrawer() {
  const open = useDrawerStore((s) => s.open);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width * 0.82);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 220 });
  }, [open, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-panelWidth, 0]) }],
  }));

  const projectId = useProjectStore((s) => s.projectId);
  const { data } = useProjects();
  const project = data?.projects?.find((p) => p.id === projectId);

  const go = (path: '/projects' | '/settings') => {
    closeDrawer();
    router.push(path);
  };

  return (
    <View
      // Always mounted; inert (no touch capture) while closed so the animation
      // can play out in both directions.
      pointerEvents={open ? 'auto' : 'none'}
      style={{ zIndex: 50 }}
      className="absolute inset-0"
    >
      <Animated.View style={backdropStyle} className="absolute inset-0 bg-black">
        <Pressable
          accessibilityLabel="Close menu"
          className="flex-1"
          onPress={closeDrawer}
        />
      </Animated.View>

      <Animated.View
        style={[panelStyle, { width: panelWidth, paddingTop: insets.top + 12 }]}
        className="absolute bottom-0 left-0 top-0 border-r border-border bg-card"
      >
        <Text className="px-4 pb-3 text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
          Shot Studio
        </Text>
        <View className="gap-1 px-2">
          <DrawerRow
            icon={<FolderKanban size={18} color={FG} />}
            sublabel="Project"
            label={project?.name || 'Select project'}
            onPress={() => go('/projects')}
            trailing={<ChevronRight size={18} color={MUTED} />}
          />
          <View className="my-1 h-px bg-border" />
          <DrawerRow
            icon={<Settings2 size={18} color={FG} />}
            label="Settings"
            onPress={() => go('/settings')}
            trailing={<ChevronRight size={18} color={MUTED} />}
          />
        </View>
      </Animated.View>
    </View>
  );
}
