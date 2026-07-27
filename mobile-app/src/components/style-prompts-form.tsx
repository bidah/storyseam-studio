import { Pressable, ScrollView, Text, View } from 'react-native';
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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="grow gap-3 px-5 pt-5 pb-12">
      <Text className="text-[12px] leading-4 text-muted-foreground">{STYLE_PROMPTS_FOOTNOTE}</Text>
      {presets.map((p) => (
        <View
          key={p.id}
          className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3"
        >
          <Pressable className="flex-1 flex-row items-center gap-2" onPress={() => onOpen(p.id)}>
            <View className="flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                <Text className="text-[14px] font-medium text-foreground" numberOfLines={1}>
                  {p.name}
                </Text>
                {p.builtin ? <Badge variant="muted" label="seed" /> : null}
              </View>
              <Text className="text-[12px] text-muted-foreground" numberOfLines={1}>
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
            className="p-1"
          >
            <Trash2 size={16} color={colors.destructive} />
          </Pressable>
        </View>
      ))}
      {presets.length === 0 ? (
        <Text className="text-[13px] text-muted-foreground">No presets yet</Text>
      ) : null}
      <Button variant="outline" title="Add preset" onPress={onAdd} disabled={busy} />
    </ScrollView>
  );
}
