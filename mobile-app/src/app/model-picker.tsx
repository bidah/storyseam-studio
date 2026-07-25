import { Fragment, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { AGENT_MODELS, type AgentModelId, useAgentModelStore } from '@/lib/agent-model';
import { SHEET_CONTENT_STYLE } from '@/lib/sheet';
import { useColors } from '@/lib/colors';

// Chat model picker — a native formSheet sized to its content
// (sheetAllowedDetents: 'fitToContents' in _layout) with a native header, a
// circular close button on the right, and one iOS inset-grouped card holding
// the model rows (title + subtitle, hairline separators). Models only — no
// effort control. The picked id rides every /eve request as x-flue-model, which
// the Worker's /eve proxy forwards into the flue agent Durable Object.
export default function ModelPickerSheet() {
  const { model, setModel } = useAgentModelStore();
  // The tapped model shows its check for a beat before the sheet closes.
  const [pending, setPending] = useState<AgentModelId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = useColors();

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const pick = (id: AgentModelId) => {
    if (pending) return; // ignore taps while a close is queued
    Haptics.selectionAsync().catch(() => {});
    setPending(id);
    setModel(id); // persist immediately; the delay is only for the check-mark beat
    timer.current = setTimeout(() => router.back(), 500);
  };

  const checkedId = pending ?? model;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select model',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={() => router.back()}
            >
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
      {/* The formSheet's native header floats transparently over the content
          (glass); the content reserves space for it and cancels the nav-bar
          height the fitToContents detent adds — see SHEET_CONTENT_STYLE. */}
      <View className="bg-background px-4" style={SHEET_CONTENT_STYLE}>
        <View className="overflow-hidden rounded-[28px] border border-border bg-card">
          {AGENT_MODELS.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.label}
                className="flex-row items-center justify-between px-4 py-4 active:bg-secondary"
                onPress={() => pick(m.id)}
              >
                <View className="mr-3 flex-1">
                  <Text className="text-[16px] font-medium text-foreground">{m.label}</Text>
                  <Text className="mt-0.5 text-[13px] text-muted-foreground">{m.hint}</Text>
                </View>
                {checkedId === m.id ? <Check size={18} color={colors.primary} /> : null}
              </Pressable>
            </Fragment>
          ))}
        </View>
      </View>
    </>
  );
}
