import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Bouncy press wrapper — a "button type" for tappable cards (the scrollable
// episode beat cards, still/take thumbs, …). Press-in shrinks with a quick
// timing, release springs back with a little overshoot so the tap feels bouncy.
//
// Styling convention: the card look lives on an INNER plain <View style> — the
// Animated.Pressable owns only the transform + gesture, so the two never fight
// over the `style` prop. The bounce is the press feedback, so consumers don't
// add their own pressed styling.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type BouncyPressableProps = {
  children?: ReactNode;
  onPress?: () => void;
  /** Style applied to the inner view that holds the card's look. */
  style?: StyleProp<ViewStyle>;
  /** Scale at full press. Cards read best subtle (~0.96); smaller = punchier. */
  pressedScale?: number;
  /** Light impact haptic on press. */
  haptic?: boolean;
  disabled?: boolean;
  /**
   * Whether `disabled` also fades the card to half opacity. On by default —
   * that fade IS the affordance for most disabled buttons.
   *
   * Off for a card that draws its own finished state. The suggestion deck's
   * completed cards keep their artwork at full strength under a dark scrim and
   * a Completed badge (see PressCard in app/(tabs)/chat/index.tsx); stacking a
   * 50% fade under that scrim doesn't read as "more disabled", it reads as a
   * washed-out picture behind a grey film.
   */
  dimWhenDisabled?: boolean;
  accessibilityLabel?: string;
  hitSlop?: number;
};

export function BouncyPressable({
  children,
  onPress,
  style,
  pressedScale = 0.96,
  haptic = true,
  disabled,
  dimWhenDisabled = true,
  accessibilityLabel,
  hitSlop = 8,
}: BouncyPressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={hitSlop}
      style={animatedStyle}
      onPressIn={() => {
        scale.value = withTiming(pressedScale, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 11, stiffness: 220, mass: 0.6 });
      }}
      onPress={() => {
        if (disabled) return;
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
    >
      <View style={[disabled && dimWhenDisabled ? { opacity: 0.5 } : null, style]}>
        {children}
      </View>
    </AnimatedPressable>
  );
}
