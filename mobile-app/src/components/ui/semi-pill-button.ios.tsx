/**
 * SemiPillButton (iOS) — the `glass` variant, on an iOS 26 Liquid-Glass surface.
 * Metro resolves this file on iOS; semi-pill-button.tsx (the base) is used on
 * Android/web. Same props on both.
 *
 * The tint is the page FOREGROUND rather than a fixed hex: a white slab on the
 * dark page, a near-black one on the light page, both with the label in the page
 * background colour. That's the same fill the `bounce` variant paints flat — so
 * switching `variant` changes the press feel and the surface, not the design.
 *
 * `variant="bounce"`, and any iOS below 26 where `isLiquidGlassAvailable()` is
 * false, fall through to the base implementation.
 */
import { ActivityIndicator, Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useColors } from '@/lib/colors';
import { cn } from '@/lib/utils';
import {
  SemiPillButton as BounceSemiPillButton,
  semiPillStyles,
  type SemiPillButtonProps,
} from './semi-pill-button-base';

export {
  SEMI_PILL,
  semiPillStyles,
  type SemiPillButtonProps,
  type SemiPillVariant,
} from './semi-pill-button-base';

const glassAvailable = isLiquidGlassAvailable();

export function SemiPillButton(props: SemiPillButtonProps) {
  const {
    title,
    onPress,
    variant = 'glass',
    children,
    loading,
    disabled,
    haptic = true,
    className,
    accessibilityLabel,
  } = props;

  const colors = useColors();
  const off = disabled || loading;

  if (variant === 'bounce' || !glassAvailable) return <BounceSemiPillButton {...props} />;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={off}
      // Layout only — the glass surface owns the shape and the fill.
      className={cn('w-full', off && 'opacity-50', className)}
      onPress={() => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
    >
      <GlassView
        glassEffectStyle="regular"
        tintColor={colors.foreground}
        isInteractive
        style={semiPillStyles.face}
      >
        {loading ? <ActivityIndicator size="small" color={colors.pageBg} /> : null}
        {children}
        <Text style={[semiPillStyles.label, { color: colors.pageBg }]}>{title}</Text>
      </GlassView>
    </Pressable>
  );
}
