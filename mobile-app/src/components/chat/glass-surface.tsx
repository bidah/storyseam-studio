import { GlassContainer, GlassView, type GlassStyle, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View, type ViewProps } from 'react-native';

// Liquid glass is only available on iOS 26+. Elsewhere (older iOS, Android)
// fall back to a plain View filled with `fallbackColor`, so callers get a
// solid surface instead of a transparent gap. (Lifted from the donor chat kit.)
const glassAvailable = isLiquidGlassAvailable();

type GlassSurfaceProps = ViewProps & {
  glassEffectStyle?: GlassStyle;
  tintColor?: string;
  isInteractive?: boolean;
  /** Background used when liquid glass is unavailable. */
  fallbackColor?: string;
  /**
   * Hairline drawn ONLY on the fallback path. Never put a border on real glass:
   * a CALayer border is a property of the RN view's bounds, so it cannot follow
   * the swell UIKit applies to an `isInteractive` surface under a press — the
   * glass grows and the border stays put, a visible double edge. Glass defines
   * its own rim; the flat fallback needs one drawn.
   */
  fallbackBorderColor?: string;
};

export function GlassSurface({
  glassEffectStyle = 'regular',
  tintColor,
  isInteractive,
  fallbackColor,
  fallbackBorderColor,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  if (glassAvailable) {
    return (
      <GlassView
        glassEffectStyle={glassEffectStyle}
        tintColor={tintColor}
        isInteractive={isInteractive}
        style={style}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      style={[
        style,
        fallbackColor ? { backgroundColor: fallbackColor } : null,
        fallbackBorderColor
          ? {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: fallbackBorderColor,
              // Only the flat fallback clips: on the glass path `clipsToBounds`
              // would cut off the interactive swell.
              overflow: 'hidden' as const,
            }
          : null,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// The liquid-glass *container* (SwiftUI's GlassEffectContainer): it groups the
// <GlassSurface>s inside it so iOS composites them as ONE glass system — they
// sample the same backdrop and blend/morph into each other when they come
// within `spacing`. A lone glass view still wants one: without a container each
// surface is its own island, which is what makes a floating bar read as a flat
// card rather than glass over the content scrolling beneath it.
// Off iOS 26 it collapses to a plain View, exactly like GlassSurface.
export function GlassGroup({
  spacing,
  style,
  children,
  ...rest
}: ViewProps & { spacing?: number }) {
  if (glassAvailable) {
    return (
      <GlassContainer spacing={spacing} style={style} {...rest}>
        {children}
      </GlassContainer>
    );
  }
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}
