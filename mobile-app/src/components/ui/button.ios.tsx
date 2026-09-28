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
import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import * as Haptics from 'expo-haptics';
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from 'expo-glass-effect';
import { useColors } from '@/lib/colors';
import { Button as PressableButton, type ButtonProps } from './button-base';

export { buttonStyles, type ButtonProps, type ButtonSize, type ButtonVariant } from './button-base';

const glassAvailable = isLiquidGlassAvailable();

// The glass tints are the THEME's primary / destructive (the native tint wants
// a concrete colour, which useColors() gives): fal purple on light, the HUD
// orange on dark — see src/unistyles.ts. The sentinels below are swapped for
// them at render.
const TINT = 'primary';
const RED = 'destructive';

// Which variants get glass, and how. `null` = no glass (falls back to base).
const GLASS: Record<string, { style: GlassStyle; tint?: string; border?: boolean } | null> = {
  default: { style: 'regular', tint: TINT },
  secondary: { style: 'regular' },
  outline: { style: 'clear', border: true },
  destructive: { style: 'regular', tint: RED },
  ghost: null,
};

// Size geometry, mirroring buttonStyles in button-base (44/32/52 heights,
// 16/12/24 horizontal padding; icon = 40×40). Square corners, like the web's
// design system (design.md: `rounded` is 0 at every step).
const SIZES: Record<string, ViewStyle> = {
  default: { height: 44, paddingHorizontal: 16, borderRadius: 0 },
  sm: { height: 32, paddingHorizontal: 12, borderRadius: 0 },
  lg: { height: 52, paddingHorizontal: 24, borderRadius: 0 },
  icon: { height: 40, width: 40, borderRadius: 0 },
};

const styles = StyleSheet.create((theme) => ({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  // Same label mapping as buttonStyles in button-base — duplicated here rather
  // than shared so each component owns its variant selection.
  label: {
    fontWeight: '600',
    variants: {
      variant: {
        default: { color: theme.colors.primaryForeground },
        secondary: { color: theme.colors.secondaryForeground },
        outline: { color: theme.colors.foreground },
        ghost: { color: theme.colors.foreground },
        destructive: { color: theme.colors.destructiveForeground },
      },
      size: {
        default: { fontSize: 15 },
        sm: { fontSize: 13 },
        lg: { fontSize: 16 },
        icon: { fontSize: 15 },
      },
    },
  },
}));

export function Button(props: ButtonProps) {
  const {
    title,
    loading,
    haptic = true,
    variant = 'default',
    size = 'default',
    style,
    textStyle,
    children,
    disabled,
    onPress,
    ...rest
  } = props;

  // `default` is unistyles' FALLBACK key, not a selectable name — see the same
  // note in button-base.
  styles.useVariants({
    variant: variant === 'default' ? undefined : variant,
    size: size === 'default' ? undefined : size,
  });
  const colors = useColors();
  const g = GLASS[variant];
  // Older iOS / Android, or a chromeless ghost → the plain Pressable base.
  if (!glassAvailable || !g) return <PressableButton {...props} />;

  const geom = SIZES[size];
  const off = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      // Only layout-affecting styles here (flex / width / margins); the glass
      // surface owns the shape and background.
      style={[off && { opacity: 0.5 }, style]}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      {...rest}
    >
      <GlassView
        glassEffectStyle={g.style}
        tintColor={g.tint === TINT ? colors.primary : g.tint === RED ? colors.destructive : g.tint}
        isInteractive
        style={[
          styles.content,
          geom,
          // Tinted glass (default/destructive) keeps a hairline; untinted
          // (outline) uses the scheme border so it reads on a light page.
          g.border ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border } : null,
        ]}
      >
        {/* On a tinted (primary/red) glass the spinner stays white; on an
            untinted glass it takes the foreground so it shows in light mode. */}
        {loading ? (
          <ActivityIndicator
            size="small"
            color={g.tint === TINT ? colors.primaryForeground : g.tint ? 'white' : colors.foreground}
          />
        ) : null}
        {children}
        {title ? <Text style={[styles.label, textStyle]}>{title}</Text> : null}
      </GlassView>
    </Pressable>
  );
}
