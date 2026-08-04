import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemMenuAction,
  NativeStackHeaderItemMenuSubmenu,
  NativeStackNavigationOptions,
} from 'expo-router/build/react-navigation/native-stack/types';
import { FolderKanban, RefreshCw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useProjectStore } from '@/lib/project';
import { useProjects, type Project } from '@/lib/queries';

// Shared native-header building blocks. Each tab nests its own Stack (so it gets
// an expo-router native header); these describe the controls that used to live
// in the custom ScreenHeader — the menu (left) + refresh (right).
//
// On iOS the controls are NATIVE bar button items (`unstable_headerLeftItems` /
// `unstable_headerRightItems` → UIBarButtonItem), not React views. On iOS 26 a
// `type:'menu'` item MORPHS open with the system liquid-glass effect (the same
// native path as expo-router's <Stack.Toolbar.Menu>), so the burger is now a
// context menu instead of the old JS slide-in drawer. Native items also collapse
// into an overflow menu when they don't fit and animate with the bar. These
// `unstable_header*Items` options are iOS-only and override headerLeft /
// headerRight there; the <Pressable> versions below remain the Android/web
// fallback.
//
// Menu items take SF Symbols, not lucide glyphs (a native item can't host a
// React icon); icon-only bar buttons pass an empty label + accessibilityLabel.

// Switch the active project the same way the /projects sheet does: flip the
// stored id (every request header + media URL follows), drop the whole query
// cache so no stale cross-project data survives, and mirror it server-side.
function useSwitchProject() {
  const projectId = useProjectStore((s) => s.projectId);
  const setProjectId = useProjectStore((s) => s.setProjectId);
  const queryClient = useQueryClient();
  return (p: Project) => {
    if (p.id === projectId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setProjectId(p.id);
    queryClient.clear();
    postJson(`/api/projects/${p.id}/activate`).catch(() => {});
  };
}

// The menu — headerLeft item on every tab. On iOS it's a native `type:'menu'`
// bar button that opens the liquid-glass context menu. Projects live in a nested
// (non-inline) SUBMENU so the first tap shows a compact menu — Projects + Settings
// — and you drill INTO "Projects" to switch project or manage them, rather than
// spilling every project into the first level. Replaces the old openDrawer burger.
export function useMenuItem(): NativeStackHeaderItem {
  const projectId = useProjectStore((s) => s.projectId);
  const { data } = useProjects();
  const switchProject = useSwitchProject();
  const projects = data?.projects ?? [];
  const currentName = projects.find((p) => p.id === projectId)?.name;

  const projectActions: NativeStackHeaderItemMenuAction[] = projects.map((p) => ({
    type: 'action',
    label: p.name,
    // Single-selection menu ⇒ the active project shows a checkmark.
    state: p.id === projectId ? 'on' : 'off',
    onPress: () => switchProject(p),
  }));

  const items: (NativeStackHeaderItemMenuAction | NativeStackHeaderItemMenuSubmenu)[] = [];

  // Pinned context header at the very top: which project are we in. `disabled`
  // ⇒ a non-tappable label, not a switch target — the actual switching lives in
  // the Projects submenu below. Only shown once the active project is known.
  if (currentName) {
    items.push({
      type: 'submenu',
      inline: true,
      label: '',
      items: [
        {
          type: 'action',
          label: currentName,
          icon: { type: 'sfSymbol', name: 'folder.fill' },
          disabled: true,
          onPress: () => {},
        },
      ],
    });
  }

  items.push(
    {
      // Non-inline submenu → tapping "Projects" opens a second level.
      type: 'submenu',
      label: 'Projects',
      icon: { type: 'sfSymbol', name: 'folder' },
      items: [
        ...projectActions,
        {
          // Inline section pinned under the project list.
          type: 'submenu',
          inline: true,
          label: '',
          items: [
            {
              type: 'action',
              label: 'Manage projects…',
              icon: { type: 'sfSymbol', name: 'slider.horizontal.3' },
              onPress: () => router.push('/projects'),
            },
          ],
        },
      ],
    },
    {
      type: 'action',
      label: 'Settings',
      icon: { type: 'sfSymbol', name: 'gearshape' },
      onPress: () => router.push('/settings'),
    },
  );

  return {
    type: 'menu',
    label: '',
    icon: { type: 'sfSymbol', name: 'line.3.horizontal' },
    accessibilityLabel: 'Menu',
    menu: { items },
  };
}

// Refresh — the sole headerRight item on the content tabs. Invalidates the whole
// project scope (+ account), matching the old ScreenHeader behaviour.
export function useTabActionItems(): NativeStackHeaderItem[] {
  const projectId = useProjectStore((s) => s.projectId);
  const queryClient = useQueryClient();
  return [
    {
      type: 'button',
      label: '',
      icon: { type: 'sfSymbol', name: 'arrow.clockwise' },
      accessibilityLabel: 'Refresh',
      onPress: () => {
        if (projectId) queryClient.invalidateQueries({ queryKey: [projectId] });
        queryClient.invalidateQueries({ queryKey: ['account'] });
      },
    },
  ];
}

// Android/web fallback for useMenuItem — no native menu there, so degrade to a
// button that opens the /projects sheet (project switch + Settings live inside).
export function MenuButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Menu"
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      onPress={() => router.push('/projects')}
    >
      <FolderKanban size={20} color={colors.foreground} />
    </Pressable>
  );
}

// Android/web fallback for useTabActionItems.
export function TabHeaderActions() {
  const projectId = useProjectStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const colors = useColors();
  return (
    <View style={styles.headerActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        onPress={() => {
          if (projectId) queryClient.invalidateQueries({ queryKey: [projectId] });
          queryClient.invalidateQueries({ queryKey: ['account'] });
        }}
      >
        <RefreshCw size={17} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

// Shared native header styling (colors, compact iOS title), scheme-aware. Spread
// into each tab's Stack screenOptions; per-screen options add title/headerLeft/
// Right. Titles are inline (not large): several tabs open with a fixed
// <Segmented> sub-nav that a large title would draw over and clip.
export function useHeaderBase(): NativeStackNavigationOptions {
  const colors = useColors();
  return {
    headerShown: true,
    headerLargeTitle: false,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.pageBg },
    headerLargeStyle: { backgroundColor: colors.pageBg },
    headerTintColor: colors.foreground,
    headerTitleStyle: { color: colors.foreground },
    headerLargeTitleStyle: { color: colors.foreground },
    contentStyle: { backgroundColor: colors.pageBg },
  };
}

// Full options for a content tab's root screen: shared styling + title + the
// menu (left) + refresh (right). A hook rather than a plain function because the
// items read the active project and the query client, and the
// `unstable_header*Items` callbacks run outside a component, so they can't.
//
// `refresh: false` drops the right-side refresh button entirely — used by tabs
// that reload via pull-to-refresh (and/or host their own header title), so the
// bar button would be redundant.
export function useTabHeaderOptions(
  title: string,
  opts?: { refresh?: boolean },
): NativeStackNavigationOptions {
  const showRefresh = opts?.refresh ?? true;
  const headerBase = useHeaderBase();
  const menuItem = useMenuItem();
  const actionItems = useTabActionItems();
  return {
    ...headerBase,
    title,
    unstable_headerLeftItems: () => [menuItem],
    unstable_headerRightItems: () => (showRefresh ? actionItems : []),
    headerLeft: () => <MenuButton />,
    headerRight: showRefresh ? () => <TabHeaderActions /> : undefined,
  };
}

const styles = StyleSheet.create({
  iconButton: { height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  pressed: { opacity: 0.6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
