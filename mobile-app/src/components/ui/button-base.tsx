import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/utils';

// Pressable button — the cross-platform base. It ships as-is on Android/web
// (via button.tsx) and is also the fallback the iOS Liquid-Glass button
// (button.ios.tsx) delegates to for icon-only / loading / children buttons that
// a native SwiftUI Button can't render. Living in a platform-neutral filename
// lets button.ios.tsx import it without resolving back onto itself.

export const buttonVariants = cva(
  'flex-row items-center justify-center gap-2 rounded-xl active:opacity-80',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border border-border bg-transparent',
        ghost: 'bg-transparent',
        destructive: 'bg-destructive',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-8 px-3 rounded-lg',
        lg: 'h-13 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const textVariants = cva('font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground',
    },
    size: {
      default: 'text-[15px]',
      sm: 'text-[13px]',
      lg: 'text-base',
      icon: 'text-[15px]',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    title?: string;
    loading?: boolean;
    haptic?: boolean;
    className?: string;
    textClassName?: string;
    children?: React.ReactNode;
  };

export function Button({
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
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), (disabled || loading) && 'opacity-50', className)}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color="white" /> : null}
      {children}
      {title ? <Text className={cn(textVariants({ variant, size }), textClassName)}>{title}</Text> : null}
    </Pressable>
  );
}
