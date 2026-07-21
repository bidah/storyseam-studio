/**
 * Button (iOS) — the shared Button rendered on an iOS 26 Liquid-Glass surface.
 * Metro resolves this file on iOS; button.tsx (the Pressable base) is used on
 * Android/web. Same props on both, so callers keep
 * `import { Button } from '@/components/ui/button'`.
 *
 * The content (lucide icon `children`, spinner, `title`) is nested INSIDE a
 * `GlassView` (expo-glass-effect) — the same nesting the chat composer's
 * GlassSurface uses, which is what actually composites a visible glass. A
 * Pressable wraps it for the touch/haptic/onPress behaviour. This is why
 * icon+label CTAs like "Let's create the world" become glass instead of the
 * flat filled Pressable.
 *
 * variant → glass:
 *   default     → regular glass, emerald tint (the CTA)
 *   secondary   → regular glass, no tint
 *   outline     → clear glass + hairline border
 *   destructive → regular glass, red tint
 *   ghost       → no glass (chromeless text action) → Pressable base, unchanged
 *
 * Liquid glass is iOS 26+ only; on older iOS `isLiquidGlassAvailable()` is false
 * and we fall back to the Pressable base so nothing regresses.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from 'expo-glass-effect';
import { cn } from '@/lib/utils';
import { Button as PressableButton, textVariants, type ButtonProps } from './button-base';

export { buttonVariants, textVariants, type ButtonProps } from './button-base';

const glassAvailable = isLiquidGlassAvailable();

// Emerald `--primary` and red `--destructive` (global.css) as hex — the native
// glass tint can't read Tailwind classes.
const TINT = '#10b981';
const RED = '#dc2626';

// Which variants get glass, and how. `null` = no glass (falls back to base).
const GLASS: Record<string, { style: GlassStyle; tint?: string; border?: boolean } | null> = {
  default: { style: 'regular', tint: TINT },
  secondary: { style: 'regular' },
  outline: { style: 'clear', border: true },
  destructive: { style: 'regular', tint: RED },
  ghost: null,
};

// Size geometry, mirroring buttonVariants in button-base (h-11/h-8/h-13, px-4/
// px-3/px-6, rounded-xl=12/rounded-lg=8; icon = 40×40 square).
const SIZES: Record<string, ViewStyle> = {
  default: { height: 44, paddingHorizontal: 16, borderRadius: 12 },
  sm: { height: 32, paddingHorizontal: 12, borderRadius: 8 },
  lg: { height: 52, paddingHorizontal: 24, borderRadius: 12 },
  icon: { height: 40, width: 40, borderRadius: 12 },
};

export function Button(props: ButtonProps) {
  const {
    title,
    loading,
    haptic = true,
    variant,
    size,
    className,
    textClassName,
    children,
    disabled,
    onPress,
    ...rest
  } = props;

  const v = variant ?? 'default';
  const g = GLASS[v];
  // Older iOS / Android, or a chromeless ghost → the plain Pressable base.
  if (!glassAvailable || !g) return <PressableButton {...props} />;

  const geom = SIZES[size ?? 'default'];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      // Only layout-affecting classes here (flex-1 / w-full / margins); the glass
      // surface owns the shape and background.
      className={cn((disabled || loading) && 'opacity-50', className)}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      {...rest}
    >
      <GlassView
        glassEffectStyle={g.style}
        tintColor={g.tint}
        isInteractive
        style={[
          styles.content,
          geom,
          g.border ? styles.border : null,
        ]}
      >
        {loading ? <ActivityIndicator size="small" color="white" /> : null}
        {children}
        {title ? <Text className={cn(textVariants({ variant: v, size }), textClassName)}>{title}</Text> : null}
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  border: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});
