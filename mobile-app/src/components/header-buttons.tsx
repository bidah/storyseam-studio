import { Pressable, View } from 'react-native';
import type {
  NativeStackHeaderItem,
  NativeStackNavigationOptions,
} from 'expo-router/build/react-navigation/native-stack/types';
import { Menu, RefreshCw } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { openDrawer } from '@/lib/drawer';
import { useProjectStore } from '@/lib/project';

// Shared native-header building blocks. Each tab nests its own Stack (so it gets
// an expo-router native header); these describe the controls that used to live
// in the custom ScreenHeader — project switcher (left) + refresh/settings
// (right).
//
// On iOS the controls are NATIVE bar button items (`unstable_headerLeftItems` /
// `unstable_headerRightItems` → UIBarButtonItem), not React views: on iOS 26 the
// navigation bar draws its own liquid-glass capsule around header items, so a
// React <Pressable> carrying its own pill background renders a pill inside a
// pill. Native items also collapse into an overflow menu when they don't fit and
// animate with the bar. The options are iOS-only and override headerLeft /
// headerRight there; the <Pressable> versions below remain the Android/web
// fallback.
//
// Items take SF Symbols, not lucide glyphs (a native item can't host a React
// icon); icon-only items pass an empty label plus an accessibilityLabel.

const MUTED = '#a1a1aa';
const BG = '#0a0a0b';
const FG = '#fafafa';

// Burger — headerLeft item on every tab. Opens the navigation drawer, which now
// holds the project selector (first row) and Settings (TOO-11).
export function useBurgerItem(): NativeStackHeaderItem {
  return {
    type: 'button',
    label: '',
    icon: { type: 'sfSymbol', name: 'line.3.horizontal' },
    accessibilityLabel: 'Open menu',
    onPress: () => openDrawer(),
  };
}

// Refresh — the sole headerRight item on the content tabs now that Settings has
// moved into the drawer. Invalidates the whole project scope (+ account),
// matching the old ScreenHeader behaviour.
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

// Android/web fallback for useBurgerItem.
export function BurgerButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
      onPress={() => openDrawer()}
    >
      <Menu size={22} color={FG} />
    </Pressable>
  );
}

// Android/web fallback for useTabActionItems.
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
    </View>
  );
}

// Shared dark-theme native header styling (colors, compact iOS title). Spread
// into each tab's Stack screenOptions; per-screen options add title/headerLeft/
// Right. Titles are inline (not large): several tabs open with a fixed
// <Segmented> sub-nav that a large title would draw over and clip.
export const HEADER_BASE = {
  headerShown: true,
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: BG },
  headerLargeStyle: { backgroundColor: BG },
  headerTintColor: FG,
  headerTitleStyle: { color: FG },
  headerLargeTitleStyle: { color: FG },
  contentStyle: { backgroundColor: BG },
} satisfies NativeStackNavigationOptions;

// Full options for a content tab's root screen: shared styling + title +
// project switcher (left) + refresh/settings (right). A hook rather than a plain
// function because the items read the active project and the query client, and
// the `unstable_header*Items` callbacks run outside a component, so they can't.
export function useTabHeaderOptions(title: string): NativeStackNavigationOptions {
  const burgerItem = useBurgerItem();
  const actionItems = useTabActionItems();
  return {
    ...HEADER_BASE,
    title,
    unstable_headerLeftItems: () => [burgerItem],
    unstable_headerRightItems: () => actionItems,
    headerLeft: () => <BurgerButton />,
    headerRight: () => <TabHeaderActions />,
  };
}
