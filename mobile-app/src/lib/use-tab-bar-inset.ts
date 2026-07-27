import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Room at the bottom of a tab's scroll surface for the bar cluster it scrolls
// under: the liquid-glass tab bar, and — since the studio agent moved into a
// `<NativeTabs.BottomAccessory>` — the accessory riding above it.
//
// The number comes from the SafeAreaProvider expo-router mounts around each
// tab's content (see NativeTabsView.ios.js), which measures the screen INSIDE
// the bar cluster. So `insets.bottom` is already tab bar + gap + accessory
// (139pt on an iPhone 17 Pro Max with the accessory up, 83 without it) and it
// re-reports on its own when the accessory mounts, unmounts, or shrinks. Do NOT
// hardcode a height or measure the accessory by hand — this hook is the source.
//
// It's a `contentInset`, not extra `paddingBottom`, for two reasons: it ADDS to
// whatever bottom padding the content container already declares, so no call
// site has to restate its own spacing as a number; and it leaves the content
// itself running full-bleed to the window edge, which is what keeps rows
// passing UNDER the glass as you scroll (the thing the glass refracts) instead
// of stopping short of it.
//
//   <FlatList {...useTabBarScrollProps()} … />
//
// Only for VERTICAL scroll surfaces on a tab. The chat tab's own surfaces are
// the exception — they dock a <Composer> and do their own bottom math.
export function useTabBarScrollProps() {
  const { bottom } = useSafeAreaInsets();
  return {
    contentInset: { bottom },
    scrollIndicatorInsets: { bottom },
  };
}
