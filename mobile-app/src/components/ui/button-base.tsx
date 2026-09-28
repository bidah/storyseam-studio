import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import * as Haptics from 'expo-haptics';

// Pressable button — the cross-platform base. It ships as-is on Android/web
// (via button.tsx) and is also the fallback the iOS Liquid-Glass button
// (button.ios.tsx) delegates to for icon-only / loading / children buttons that
// a native SwiftUI Button can't render. Living in a platform-neutral filename
// lets button.ios.tsx import it without resolving back onto itself.

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  title?: string;
  loading?: boolean;
  haptic?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Layout overrides for the button itself (width, margins, flex). */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  children?: React.ReactNode;
};

export const buttonStyles = StyleSheet.create((theme) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 0, // square, like the web (design.md)
    variants: {
      variant: {
        default: { backgroundColor: theme.colors.primary },
        secondary: { backgroundColor: theme.colors.secondary },
        outline: {
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: 'transparent',
        },
        ghost: { backgroundColor: 'transparent' },
        destructive: { backgroundColor: theme.colors.destructive },
      },
      size: {
        default: { height: 44, paddingHorizontal: 16 },
        sm: { height: 32, paddingHorizontal: 12 },
        lg: { height: 52, paddingHorizontal: 24 },
        icon: { height: 40, width: 40 },
      },
    },
  },
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

export function Button({
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
}: ButtonProps) {
  // `default` is unistyles' FALLBACK key, not a selectable name — it's the
  // branch applied when a variant group gets no selection, so it has to be
  // passed as `undefined` rather than by name.
  buttonStyles.useVariants({
    variant: variant === 'default' ? undefined : variant,
    size: size === 'default' ? undefined : size,
  });
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      style={({ pressed }) => [
        buttonStyles.button,
        off ? { opacity: 0.5 } : pressed ? { opacity: 0.8 } : null,
        style,
      ]}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color="white" /> : null}
      {children}
      {title ? <Text style={[buttonStyles.label, textStyle]}>{title}</Text> : null}
    </Pressable>
  );
}
