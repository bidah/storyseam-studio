import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useSheetContentStyle } from '@/lib/sheet';
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
  // 32 == the px-8 below, so the gap under the card matches the sides.
  const contentStyle = useSheetContentStyle(32);

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
              style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
              onPress={() => router.back()}
            >
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      {/* The formSheet's native header floats transparently over the content
          (glass); the content reserves space for it and cancels the nav-bar
          height the fitToContents detent adds — see useSheetContentStyle. One
          iOS inset-grouped card with hairline dividers and a big liquid-glass
          radius — matches the chat model picker. */}
      <View style={[styles.container, contentStyle]}>
        <View style={styles.card}>
          {list.map((opt, i) => (
            <Fragment key={opt.value}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => pick(opt.value)}
              >
                <Text style={styles.label} numberOfLines={1}>
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

const styles = StyleSheet.create((theme) => ({
  closeButton: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  container: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: 32,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  divider: {
    marginLeft: 16,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  rowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  label: {
    marginRight: 12,
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
}));
