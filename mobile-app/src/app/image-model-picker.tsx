import { Fragment, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { splitImageModels, useImageModelPickerStore } from '@/lib/image-model-picker';
import { useSheetContentStyle } from '@/lib/sheet';
import { useColors } from '@/lib/colors';

// Image-model picker — a single fit-to-content formSheet (registered in the root
// _layout with sheetAllowedDetents:'fitToContents', so it hugs its rows). Two
// "pages" live in one sheet: the 6 default models + a "More models" pill, and
// the rest. Tapping the pill swaps to the rest with a native Back chevron; the
// header title/buttons swap with it. A nested native stack can't be used here —
// it collapses to 0 height under fitToContents — so the pages swap in place.
export default function ImageModelPickerSheet() {
  const { options, selected, requestId } = useImageModelPickerStore();
  const { top, rest } = splitImageModels(options);
  const [page, setPage] = useState<'default' | 'more'>('default');
  // The tapped value: shows its green check for a beat before the sheet closes.
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = useColors();
  // 32 == the px-8 below, so the gap under the card matches the sides.
  const contentStyle = useSheetContentStyle(32);

  // Single screen, so this fires only on real sheet dismissal — resolve null (a
  // pick resolves first, making this a no-op) and cancel a pending close.
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
      router.dismiss();
    }, 500);
  };

  const checkedValue = pending ?? selected;

  const Row = ({ opt, last }: { opt: { value: string; label: string }; last: boolean }) => (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={opt.label}
        className="flex-row items-center justify-between px-4 py-4 active:bg-secondary"
        onPress={() => pick(opt.value)}
      >
        <Text className="mr-3 flex-1 text-[16px] font-medium text-foreground" numberOfLines={1}>
          {opt.label}
        </Text>
        {checkedValue === opt.value ? <Check size={18} color={colors.primary} /> : null}
      </Pressable>
      {!last ? <View className="ml-4 h-px bg-border" /> : null}
    </>
  );

  const Card = ({ items }: { items: { value: string; label: string }[] }) => (
    <View className="overflow-hidden rounded-[28px] border border-border bg-card">
      {items.map((opt, i) => (
        <Fragment key={opt.value}>
          <Row opt={opt} last={i === items.length - 1} />
        </Fragment>
      ))}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          // Default iOS translucent (glass) floating header — same as the chat
          // model picker. An opaque header (headerTransparent:false) draws a solid
          // bar over the sheet's rounded top corners, squaring them and showing
          // the nav theme's grey; the glass header lets the rounded corners and
          // content show through. Content reserves the header's ~76pt via the
          // paddingTop below.
          ...(page === 'default'
            ? {
                title: 'Model',
                headerLeft: undefined,
                headerRight: () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={8}
                    className="h-8 w-8 items-center justify-center rounded-full bg-secondary active:opacity-60"
                    onPress={() => router.dismiss()}
                  >
                    <X size={18} color={colors.mutedForeground} />
                  </Pressable>
                ),
              }
            : {
                title: 'More models',
                headerRight: () => null,
                headerLeft: () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    hitSlop={8}
                    className="flex-row items-center active:opacity-60"
                    onPress={() => setPage('default')}
                  >
                    <ChevronLeft size={26} color={colors.mutedForeground} />
                  </Pressable>
                ),
              }),
        }}
      />
      {/* Plain Views (no ScrollView/navigator) so fitToContents can measure the
          height and hug the rows. The glass header floats over the content; the
          content reserves space for it and cancels the nav-bar height the
          fitToContents detent adds — see useSheetContentStyle. */}
      <View className="bg-background px-8" style={contentStyle}>
        {page === 'default' ? (
          <>
            <Card items={top} />
            {rest.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More models"
                className="mt-3 flex-row items-center justify-between rounded-full border border-border bg-card px-5 py-4 active:opacity-70"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPage('more');
                }}
              >
                <Text className="text-[16px] font-medium text-foreground">More models</Text>
                <ChevronRight size={20} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </>
        ) : (
          <Card items={rest} />
        )}
      </View>
    </>
  );
}
