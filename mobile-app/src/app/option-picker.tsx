import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useColors } from '@/lib/colors';

// Generic option picker — a native formSheet sized to its content
// (sheetAllowedDetents: 'fitToContents' in _layout) with a native header and a
// close button. Replaces the ActionSheetIOS menus in the Visual world composer.
// Params:
//   requestId — picker-bus id; resolves with the picked option's value (or null
//               when dismissed — swipe-down or the header close button)
//   title     — native header title
//   options   — JSON [{ value, label }]
//   selected  — currently active value (gets the check mark)
export default function OptionPickerSheet() {
  const { requestId, title, options, selected } = useLocalSearchParams<{
    requestId?: string;
    title?: string;
    options?: string;
    selected?: string;
  }>();

  const list = useMemo<{ value: string; label: string }[]>(() => {
    try {
      return JSON.parse(options || '[]');
    } catch {
      return [];
    }
  }, [options]);

  // The tapped value shows its check for a beat before the sheet closes.
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = useColors();

  // Resolve null if the sheet closes without a pick (a real pick resolved
  // first, so this second resolve is a no-op) and cancel a queued close.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      resolvePickerRequest(requestId, null);
    };
  }, [requestId]);

  // Show the check on the tapped row, then dismiss after a beat so the user sees
  // the selection land in place.
  const pick = (value: string) => {
    if (pending) return; // ignore taps while a close is queued
    Haptics.selectionAsync().catch(() => {});
    setPending(value);
    timer.current = setTimeout(() => {
      resolvePickerRequest(requestId, value);
      router.back();
    }, 500);
  };

  const checkedValue = pending ?? selected;

  return (
    <>
      <Stack.Screen
        options={{
          title: title || 'Choose',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full bg-secondary active:opacity-60"
              onPress={() => router.back()}
            >
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      {/* The formSheet's native header floats transparently over the content
          (glass), so the card reserves its ~56pt itself. One iOS inset-grouped
          card with hairline dividers and a big liquid-glass radius — matches
          the chat model picker. */}
      <View className="bg-background px-4 pb-8" style={{ paddingTop: 76 }}>
        <View className="overflow-hidden rounded-[28px] border border-border bg-card">
          {list.map((opt, i) => (
            <Fragment key={opt.value}>
              {i > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                className="flex-row items-center justify-between px-4 py-5 active:bg-secondary"
                onPress={() => pick(opt.value)}
              >
                <Text className="mr-3 flex-1 text-[16px] font-medium text-foreground" numberOfLines={1}>
                  {opt.label}
                </Text>
                {checkedValue === opt.value ? <Check size={18} color={colors.primary} /> : null}
              </Pressable>
            </Fragment>
          ))}
        </View>
      </View>
    </>
  );
}
