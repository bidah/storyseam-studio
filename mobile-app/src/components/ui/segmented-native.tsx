import type { ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { Segmented } from '@/components/ui/segmented';

// Fallback for Android / web: swift-ui's native Picker is iOS-only, so reuse the
// JS segmented control. iOS resolves the `.ios.tsx` sibling instead.
export function SegmentedNative<T extends string>({
  size: _size,
  height: _height,
  tintColor: _tintColor,
  iconColor: _iconColor,
  selectedIconColor: _selectedIconColor,
  options,
  ...props
}: {
  options: { value: T; label: string; icon?: SFSymbol }[];
  value: T;
  onChange: (v: T) => void;
  // Accepted for parity with the iOS variant; the JS control has one size and
  // draws its own selection chrome from the theme.
  size?: 'small' | 'regular' | 'large';
  height?: number;
  tintColor?: ColorValue;
  iconColor?: ColorValue;
  selectedIconColor?: ColorValue;
}) {
  // SF Symbols don't exist off iOS, so an icon segment falls back to its label —
  // which is why `label` is required on every option (see the .ios.tsx sibling).
  return <Segmented {...props} options={options.map(({ value, label }) => ({ value, label }))} />;
}
