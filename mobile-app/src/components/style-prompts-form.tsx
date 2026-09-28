import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ChevronRight, Trash2 } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useColors } from '@/lib/colors';
import { STYLE_PROMPTS_FOOTNOTE, type StylePromptsFormProps } from './style-prompts-form.types';

// Cross-platform fallback for the style-presets list (the .ios.tsx sibling
// renders a native SwiftUI Form with swipe-to-delete). Same props; the delete
// action is an explicit trash button since there is no swipe affordance here.
export default function StylePromptsForm({
  presets,
  onOpen,
  onDelete,
  onAdd,
  busy = false,
}: StylePromptsFormProps) {
  const colors = useColors();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.footnote}>{STYLE_PROMPTS_FOOTNOTE}</Text>
      {presets.map((p) => (
        <View key={p.id} style={styles.presetRow}>
          <Pressable style={styles.presetOpen} onPress={() => onOpen(p.id)}>
            <View style={styles.presetInfo}>
              <View style={styles.presetNameRow}>
                <Text style={styles.presetName} numberOfLines={1}>
                  {p.name}
                </Text>
                {p.builtin ? <Badge variant="muted" label="seed" /> : null}
              </View>
              <Text style={styles.presetPreview} numberOfLines={1}>
                {p.preview || 'No image style yet'}
              </Text>
            </View>
            <ChevronRight size={14} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(p.id)}
            disabled={busy}
            accessibilityLabel={`Delete ${p.name}`}
            accessibilityRole="button"
            style={styles.deleteButton}
          >
            <Trash2 size={16} color={colors.destructive} />
          </Pressable>
        </View>
      ))}
      {presets.length === 0 ? <Text style={styles.emptyText}>No presets yet</Text> : null}
      <Button variant="outline" title="Add preset" onPress={onAdd} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { flexGrow: 1, gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },
  footnote: { fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  presetOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  presetInfo: { flex: 1, gap: 2 },
  presetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presetName: { fontSize: 14, fontWeight: '500', color: theme.colors.foreground },
  presetPreview: { fontSize: 12, color: theme.colors.mutedForeground },
  deleteButton: { padding: 4 },
  emptyText: { fontSize: 13, color: theme.colors.mutedForeground },
}));
