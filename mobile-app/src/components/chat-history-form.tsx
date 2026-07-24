import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, MessageSquare, Trash2 } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { useChatColors } from '@/components/chat/theme';
import type { ChatHistoryFormProps } from './chat-history-form.types';

// Cross-platform fallback for the chat history sheet (the .ios.tsx sibling
// renders one native SwiftUI Form). Same props, RN cards.
export default function ChatHistoryForm({ chats, onSelect, onDelete }: ChatHistoryFormProps) {
  const chatC = useChatColors();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow px-4 pt-4 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      {chats.length === 0 ? (
        <Text className="px-4 py-16 text-center text-sm text-muted-foreground">No chats yet</Text>
      ) : (
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {chats.map((c, i) => (
            <View key={c.id} className={cn('flex-row items-center', i > 0 && 'border-t border-border')}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open chat: ${c.title}`}
                className={cn(
                  'min-w-0 flex-1 flex-row items-center gap-2.5 px-4 py-3.5 active:bg-secondary',
                  c.active && 'bg-primary/10',
                )}
                onPress={() => onSelect(c.id)}
              >
                {c.active ? (
                  <Check size={16} color={chatC.primary} />
                ) : (
                  <MessageSquare size={16} color={chatC.mutedForeground} />
                )}
                <Text className="min-w-0 flex-1 text-[15px] text-foreground" numberOfLines={1}>
                  {c.title}
                </Text>
                <Text className="text-[12px] text-muted-foreground">{c.subtitle}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete chat: ${c.title}`}
                className="h-12 w-12 items-center justify-center active:opacity-60"
                onPress={() => onDelete(c.id)}
              >
                <Trash2 size={16} color={chatC.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
