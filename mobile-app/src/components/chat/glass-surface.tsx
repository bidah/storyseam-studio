import { GlassView, type GlassStyle, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View, type ViewProps } from 'react-native';

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
};

export function GlassSurface({
  glassEffectStyle = 'regular',
  tintColor,
  isInteractive,
  fallbackColor,
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
    <View style={[style, fallbackColor ? { backgroundColor: fallbackColor } : null]} {...rest}>
      {children}
    </View>
  );
}
