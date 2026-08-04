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
 * `variant="clear"` is the same surface UNTINTED, for a button that sits on
 * artwork instead of on the page — see the note at the branch below.
 *
 * `variant="bounce"`, and any iOS below 26 where `isLiquidGlassAvailable()` is
 * false, fall through to the base implementation.
 */
import { ActivityIndicator, Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useColors } from '@/lib/colors';
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
    style,
    accessibilityLabel,
  } = props;

  const colors = useColors();
  const off = disabled || loading;

  if (variant === 'bounce' || !glassAvailable) return <BounceSemiPillButton {...props} />;

  // `clear` is the variant for a button drawn ON something — the showcase card's
  // artwork, where the point is that the picture carries on underneath. So: no
  // tint (a foreground tint would make it the opaque slab we're avoiding), and
  // `colorScheme="dark"` pinned rather than 'auto' so the system's own dimming
  // layer is there to hold a white label up against whatever frame the video is
  // on. Light-scheme clear glass over a bright frame leaves nothing to read.
  const clear = variant === 'clear';
  const content = clear ? '#fff' : colors.pageBg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={off}
      // Layout only — the glass surface owns the shape and the fill.
      style={[semiPillStyles.fullWidth, off && { opacity: 0.5 }, style]}
      onPress={() => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
    >
      <GlassView
        glassEffectStyle={clear ? 'clear' : 'regular'}
        tintColor={clear ? undefined : colors.foreground}
        colorScheme={clear ? 'dark' : 'auto'}
        isInteractive
        style={semiPillStyles.face}
      >
        {loading ? <ActivityIndicator size="small" color={content} /> : null}
        {children}
        <Text style={[semiPillStyles.label, { color: content }]}>{title}</Text>
      </GlassView>
    </Pressable>
  );
}
