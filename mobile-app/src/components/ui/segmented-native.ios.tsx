import { Host } from '@expo/ui';
import { Picker, Text } from '@expo/ui/swift-ui';
import { controlSize, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';

// Native SwiftUI segmented control (real UISegmentedControl under the hood).
// On iOS 26 it adopts the Liquid Glass look automatically — no extra modifier.
// Drop-in replacement for `@/components/ui/segmented` (same props); the plain
// `.tsx` sibling is the JS fallback for Android/web where swift-ui can't load.
//
// Heads-up: glass sometimes fails to propagate through the UIHostingController
// hosting layer and the segments render flat — that's expo/expo#44739, not this
// code.
export function SegmentedNative<T extends string>({
  options,
  value,
  onChange,
  size = 'regular',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  // 'large' bumps the control to the taller Photos-picker capsule; default slim.
  size?: 'regular' | 'large';
}) {
  const large = size === 'large';
  return (
    <Host style={{ height: large ? 44 : 34 }}>
      <Picker
        modifiers={[pickerStyle('segmented'), controlSize(large ? 'large' : 'regular')]}
        selection={value}
        onSelectionChange={(selection: T) => {
          if (selection !== value) {
            Haptics.selectionAsync().catch(() => {});
            onChange(selection);
          }
        }}
      >
        {options.map((opt) => (
          <Text key={opt.value} modifiers={[tag(opt.value)]}>
            {opt.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
