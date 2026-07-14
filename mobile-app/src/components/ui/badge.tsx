import { Text, View } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Status pill — mirrors the web app's extended shadcn Badge
// (success / warning / info / muted variants for statuses).
const badgeVariants = cva('flex-row items-center gap-1 self-start rounded-full px-2 py-0.5', {
  variants: {
    variant: {
      default: 'bg-primary/15',
      success: 'bg-success/15',
      warning: 'bg-warning/15',
      info: 'bg-info/15',
      muted: 'bg-muted',
      destructive: 'bg-destructive/15',
      outline: 'border border-border',
    },
  },
  defaultVariants: { variant: 'default' },
});

const badgeText = cva('text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    variant: {
      default: 'text-primary',
      success: 'text-success',
      warning: 'text-warning',
      info: 'text-info',
      muted: 'text-muted-foreground',
      destructive: 'text-destructive',
      outline: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

type Props = VariantProps<typeof badgeVariants> & {
  label: string;
  className?: string;
  children?: React.ReactNode;
};

export function Badge({ label, variant, className, children }: Props) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      {children}
      <Text className={badgeText({ variant })}>{label}</Text>
    </View>
  );
}
