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
import { cn } from '@/lib/utils';

// Bouncy press wrapper — a "button type" for tappable cards (the scrollable
// episode beat cards, still/take thumbs, …). Press-in shrinks with a quick
// timing, release springs back with a little overshoot so the tap feels bouncy.
//
// Styling convention: the card look lives on an INNER plain <View className>
// (NativeWind only interops className on the components it knows — a
// gesture-handler Animated.Pressable isn't one). The Animated.Pressable owns
// only the transform + gesture, so the two never fight over the `style` prop.
// The bounce is the press feedback, so consumers can drop their `active:*`
// classes.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type BouncyPressableProps = {
  children?: ReactNode;
  onPress?: () => void;
  /** className applied to the inner view that holds the card's look. */
  className?: string;
  /** Extra style on the inner view (rarely needed alongside className). */
  style?: StyleProp<ViewStyle>;
  /** Scale at full press. Cards read best subtle (~0.96); smaller = punchier. */
  pressedScale?: number;
  /** Light impact haptic on press. */
  haptic?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  hitSlop?: number;
};

export function BouncyPressable({
  children,
  onPress,
  className,
  style,
  pressedScale = 0.96,
  haptic = true,
  disabled,
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
      <View className={cn(disabled && 'opacity-50', className)} style={style}>
        {children}
      </View>
    </AnimatedPressable>
  );
}
