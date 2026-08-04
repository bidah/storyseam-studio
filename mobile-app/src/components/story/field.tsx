import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useColors } from '@/lib/colors';

// Tap-to-edit inline field — the mobile port of the web World tab's
// save-on-blur <textarea> (WorldField in src/routes/world.jsx). Renders the
// value as text; tapping swaps in an autofocused input; blurring commits only
// when the value actually changed.
export function EditableField({
  value,
  onCommit,
  placeholder,
  label,
  hint,
  multiline = true,
  style,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => Promise<void> | void;
  placeholder?: string;
  label?: string;
  hint?: string;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Reflect server refreshes while not editing.
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    if ((draft ?? '') === (value ?? '')) return;
    setSaving(true);
    try {
      await onCommit(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {editing ? (
        <TextInput
          ref={inputRef}
          autoFocus
          multiline={multiline}
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          placeholder={placeholder}
          placeholderTextColor={colors.subtleForeground}
          style={[styles.input, multiline && styles.inputMultiline]}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ? `Edit ${label}` : 'Edit field'}
          style={({ pressed }) => [styles.viewRow, pressed && styles.viewRowPressed]}
          onPress={() => setEditing(true)}
        >
          <Text style={[styles.valueText, (value ?? '').trim() ? styles.valueTextFilled : styles.valueTextEmpty]}>
            {(value ?? '').trim() || placeholder || '—'}
          </Text>
          {saving ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: `${theme.colors.foreground}CC`,
  },
  hint: {
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  input: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  inputMultiline: {
    minHeight: 64,
  },
  viewRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  viewRowPressed: {
    borderColor: theme.colors.border,
    backgroundColor: `${theme.colors.secondary}80`,
  },
  valueText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  valueTextFilled: {
    color: theme.colors.foreground,
  },
  valueTextEmpty: {
    color: theme.colors.mutedForeground,
  },
}));
