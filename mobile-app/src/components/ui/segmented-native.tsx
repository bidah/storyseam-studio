import { Segmented } from '@/components/ui/segmented';

// Fallback for Android / web: swift-ui's native Picker is iOS-only, so reuse the
// JS segmented control. iOS resolves the `.ios.tsx` sibling instead.
export function SegmentedNative<T extends string>({
  size: _size,
  ...props
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  // Accepted for parity with the iOS variant; the JS control has one size.
  size?: 'regular' | 'large';
}) {
  return <Segmented {...props} />;
}
