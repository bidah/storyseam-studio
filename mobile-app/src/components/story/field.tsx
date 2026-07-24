import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useColors } from '@/lib/colors';
import { cn } from '@/lib/utils';

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
  className,
}: {
  value: string | null | undefined;
  onCommit: (v: string) => Promise<void> | void;
  placeholder?: string;
  label?: string;
  hint?: string;
  multiline?: boolean;
  className?: string;
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
    <View className={className}>
      {label ? (
        <Text className="text-[12px] font-semibold text-foreground/80">{label}</Text>
      ) : null}
      {hint ? <Text className="mt-0.5 text-[11px] text-muted-foreground">{hint}</Text> : null}
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
          className={cn(
            'mt-1 rounded-lg border border-primary bg-card px-2.5 py-2 text-[14px] leading-5 text-foreground',
            multiline && 'min-h-16',
          )}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ? `Edit ${label}` : 'Edit field'}
          className="mt-1 flex-row items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 active:border-border active:bg-secondary/50"
          onPress={() => setEditing(true)}
        >
          <Text
            className={cn(
              'flex-1 text-[14px] leading-5',
              (value ?? '').trim() ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {(value ?? '').trim() || placeholder || '—'}
          </Text>
          {saving ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
        </Pressable>
      )}
    </View>
  );
}
