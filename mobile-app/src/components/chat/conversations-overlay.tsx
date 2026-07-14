import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, MessageSquare, Plus, Trash2 } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { relTime } from './helpers';
import { chatColors } from './theme';

// The chat history, rendered as an in-screen overlay dropping below the header
// (the root layout owns formSheet routes, so this surface stays local).

type ChatSummary = {
  id: string;
  title?: string;
  updatedAt?: number;
};

type Conversations = {
  activeId: string | null;
  list: ChatSummary[];
  newChat: () => void;
  switchChat: (id: string) => void;
  deleteChat: (id: string) => void;
};

export function ConversationsOverlay({
  conv,
  onClose,
}: {
  conv: Conversations;
  onClose: () => void;
}) {
  const select = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    conv.switchChat(id);
    onClose();
  };

  return (
    <View className="absolute inset-0 z-10">
      {/* Backdrop */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close chat history"
        className="absolute inset-0 bg-black/50"
        onPress={onClose}
      />
      <View className="mx-3 mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Text className="text-[15px] font-semibold text-foreground">Chats</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            className="flex-row items-center gap-1 rounded-full bg-secondary px-3 py-1.5 active:opacity-70"
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              conv.newChat();
              onClose();
            }}
          >
            <Plus size={14} color={chatColors.foreground} />
            <Text className="text-[13px] font-semibold text-foreground">New chat</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {conv.list.length === 0 ? (
            <Text className="px-4 py-8 text-center text-sm text-muted-foreground">No chats yet</Text>
          ) : (
            conv.list.map((c) => {
              const active = c.id === conv.activeId;
              return (
                <View key={c.id} className="flex-row items-center">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat: ${c.title || 'New chat'}`}
                    className={cn(
                      'min-w-0 flex-1 flex-row items-center gap-2.5 px-4 py-3 active:bg-secondary',
                      active && 'bg-primary/10',
                    )}
                    onPress={() => select(c.id)}
                  >
                    {active ? (
                      <Check size={15} color={chatColors.primary} />
                    ) : (
                      <MessageSquare size={15} color={chatColors.mutedForeground} />
                    )}
                    <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                      {c.title || 'New chat'}
                    </Text>
                    <Text className="text-[11px] text-muted-foreground">{relTime(c.updatedAt)}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete chat: ${c.title || 'New chat'}`}
                    className="h-11 w-11 items-center justify-center active:opacity-60"
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      conv.deleteChat(c.id);
                    }}
                  >
                    <Trash2 size={15} color={chatColors.mutedForeground} />
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );
}
