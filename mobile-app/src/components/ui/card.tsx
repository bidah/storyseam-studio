import { Text, View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('rounded-2xl border border-border bg-card p-4', className)} {...props} />;
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Text className={cn('text-base font-semibold text-foreground', className)}>{children}</Text>;
}

// The web app's Eyebrow — small uppercase section label.
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={cn('mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground', className)}>
      {children}
    </Text>
  );
}
