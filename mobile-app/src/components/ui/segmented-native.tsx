import { Segmented } from '@/components/ui/segmented';

// Fallback for Android / web: swift-ui's native Picker is iOS-only, so reuse the
// JS segmented control. iOS resolves the `.ios.tsx` sibling instead.
export function SegmentedNative<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return <Segmented {...props} />;
}
