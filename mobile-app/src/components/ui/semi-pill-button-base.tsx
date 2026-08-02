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
 *   clear  → UNTINTED glass, for a button that sits ON artwork rather than on
 *            the page: the picture stays visible through the slab. White label
 *            in both themes, because what's behind it is a video frame and not
 *            the page. Falls back to a dark wash where glass isn't available.
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

export type SemiPillVariant = 'glass' | 'bounce' | 'clear';

export type SemiPillButtonProps = {
  title: string;
  onPress?: () => void;
  /**
   * Press feel and surface: an iOS liquid-glass slab, a bouncy flat fill, or
   * translucent glass for sitting ON TOP of artwork (see `clear` below).
   */
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
  // `clear` without real glass: a dark wash plus a lit edge. The wash is what
  // keeps a white label readable over an arbitrary frame of video, and the edge
  // is what stops the slab dissolving into a dark one. Fixed rgba rather than
  // theme tokens — what's behind it is the artwork, which doesn't flip with the
  // app's colour scheme.
  clearFace: {
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});

export function SemiPillButton({
  title,
  onPress,
  variant = 'bounce',
  children,
  loading,
  disabled,
  haptic = true,
  className,
  accessibilityLabel,
}: SemiPillButtonProps) {
  const colors = useColors();
  const off = disabled || loading;
  // The only variant this file distinguishes. `glass` arrives here when there is
  // no glass to render (Android, web, iOS below 26) and is deliberately treated
  // as `bounce` — same shape, same fill, one less surface.
  const clear = variant === 'clear';
  // The fill IS the page's text colour, so everything on it takes the page's
  // background colour — the inversion is the whole look. `clear` opts out of
  // that entirely: it sits on artwork, not on the page, so it goes white-on-dark
  // in both themes.
  const content = clear ? '#fff' : colors.pageBg;

  return (
    <BouncyPressable
      onPress={onPress}
      disabled={off}
      haptic={haptic}
      accessibilityLabel={accessibilityLabel ?? title}
      // A slab this big shouldn't travel as far as a card does on press.
      pressedScale={0.975}
      className={cn('w-full', className)}
      style={[
        semiPillStyles.face,
        clear ? semiPillStyles.clearFace : { backgroundColor: colors.foreground },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={content} /> : null}
      {children}
      <Text style={[semiPillStyles.label, { color: content }]}>{title}</Text>
    </BouncyPressable>
  );
}
