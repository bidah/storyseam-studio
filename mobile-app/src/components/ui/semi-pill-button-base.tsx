/**
 * SemiPillButton — the hero CTA shape: a wide, tall, heavily-rounded slab that
 * stops short of a full pill (radius 20 on a 56pt height, not 28). It's the
 * "one action on the page" button — the Discover story's `Try this`.
 *
 * It comes in two press feels, chosen with `variant`:
 *
 *   glass  → an iOS 26 Liquid-Glass surface tinted with the page foreground
 *            (white slab on dark, near-black on light). Lives in
 *            semi-pill-button.ios.tsx; Metro resolves it on iOS only.
 *   bounce → a flat foreground fill on a BouncyPressable — shrinks on press-in,
 *            springs back with overshoot. The same feel as the tappable cards.
 *
 * This file is the base: it ships as-is on Android/web (via
 * semi-pill-button.tsx) and owns the bounce variant on every platform, so the
 * iOS file can delegate to it without resolving back onto itself. On Android,
 * on web, and on iOS below 26, `glass` renders as `bounce` — the shape and the
 * fill are the same either way, only the surface differs.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useColors } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { BouncyPressable } from './bouncy-pressable';

export type SemiPillVariant = 'glass' | 'bounce';

export type SemiPillButtonProps = {
  title: string;
  onPress?: () => void;
  /** Press feel: an iOS liquid-glass slab, or a bouncy flat fill. */
  variant?: SemiPillVariant;
  /** Leading content (a lucide icon), rendered before the title. */
  children?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  haptic?: boolean;
  /** Layout classes for the button itself (width, margins). */
  className?: string;
  accessibilityLabel?: string;
};

// The shape, in one place — the iOS glass file styles its GlassView with the
// same numbers so the two variants are the same button wearing two surfaces.
export const SEMI_PILL = {
  height: 56,
  paddingHorizontal: 28,
  borderRadius: 20,
} as const;

export const semiPillStyles = StyleSheet.create({
  face: {
    ...SEMI_PILL,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  label: { fontSize: 17, fontWeight: '600' },
});

export function SemiPillButton({
  title,
  onPress,
  children,
  loading,
  disabled,
  haptic = true,
  className,
  accessibilityLabel,
}: SemiPillButtonProps) {
  const colors = useColors();
  const off = disabled || loading;

  return (
    <BouncyPressable
      onPress={onPress}
      disabled={off}
      haptic={haptic}
      accessibilityLabel={accessibilityLabel ?? title}
      // A slab this big shouldn't travel as far as a card does on press.
      pressedScale={0.975}
      className={cn('w-full', className)}
      style={[semiPillStyles.face, { backgroundColor: colors.foreground }]}
    >
      {/* The fill IS the page's text colour, so everything on it takes the
          page's background colour — the inversion is the whole look. */}
      {loading ? <ActivityIndicator size="small" color={colors.pageBg} /> : null}
      {children}
      <Text style={[semiPillStyles.label, { color: colors.pageBg }]}>{title}</Text>
    </BouncyPressable>
  );
}
