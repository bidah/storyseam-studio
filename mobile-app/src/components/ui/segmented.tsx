import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/utils';

// iOS-style segmented control used for in-tab sub-surfaces
// (Story: World|Script|Shots · Assets: Library|Sounds · Sounds: Music|SFX|Voice).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <View className={cn('flex-row rounded-xl bg-secondary p-1', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            className={cn('flex-1 items-center justify-center rounded-lg py-1.5', active && 'bg-card')}
            onPress={() => {
              if (!active) {
                Haptics.selectionAsync().catch(() => {});
                onChange(opt.value);
              }
            }}
          >
            <Text className={cn('text-[13px] font-semibold', active ? 'text-foreground' : 'text-muted-foreground')}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
