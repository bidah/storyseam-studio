import { Fragment, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, Stack } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { modelsForProvider, type AgentModelId, useAgentModelStore } from '@/lib/agent-model';
import { useChatProviderStore } from '@/lib/chat-provider';
import { useSheetContentStyle } from '@/lib/sheet';
import { useColors } from '@/lib/colors';

// Chat model picker — a native formSheet sized to its content
// (sheetAllowedDetents: 'fitToContents' in _layout) with a native header, a
// circular close button on the right, and one iOS inset-grouped card holding
// the model rows (title + subtitle, hairline separators). Models only — no
// effort control. The picked id rides every /eve request as x-flue-model, which
// the Worker's /eve proxy forwards into the flue agent Durable Object.
export default function ModelPickerSheet() {
  const { model, setModel } = useAgentModelStore();
  // Only the active Settings › Chat provider's models (the selection is kept in
  // that catalog by agent-model's reconcile, so `model` is always one of these).
  const provider = useChatProviderStore((s) => s.active);
  const models = modelsForProvider(provider);
  // The tapped model shows its check for a beat before the sheet closes.
  const [pending, setPending] = useState<AgentModelId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = useColors();
  // 32 == the px-8 below, so the gap under the card matches the sides.
  const contentStyle = useSheetContentStyle(32);

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
          height the fitToContents detent adds — see useSheetContentStyle. */}
      <View style={[styles.root, contentStyle]}>
        <View style={styles.card}>
          {models.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 ? <View style={styles.separator} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.label}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => pick(m.id)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.title}>{m.label}</Text>
                  <Text style={styles.hint}>{m.hint}</Text>
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

const styles = StyleSheet.create((theme) => ({
  root: {
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
  separator: {
    marginLeft: 16,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowPressed: {
    backgroundColor: theme.colors.secondary,
  },
  rowText: {
    marginRight: 12,
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  hint: {
    marginTop: 2,
    fontSize: 13,
    color: theme.colors.mutedForeground,
  },
}));
