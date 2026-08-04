import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Check, MessageSquare, Trash2 } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { useChatColors } from '@/components/chat/theme';
import type { ChatHistoryFormProps } from './chat-history-form.types';

// Cross-platform fallback for the chat history sheet (the .ios.tsx sibling
// renders one native SwiftUI Form). Same props, RN cards.
export default function ChatHistoryForm({ chats, onSelect, onDelete }: ChatHistoryFormProps) {
  const chatC = useChatColors();
  const colors = useColors();
  return (
    <ScrollView
      style={styles.scroll}
      // The grouped background, NOT `bg-background`: in light mode --background
      // and --card are both pure white, so the card below would dissolve into
      // the page. Same pairing the iOS sibling gives its SwiftUI Form.
      contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.groupedBg }]}
      keyboardShouldPersistTaps="handled"
    >
      {chats.length === 0 ? (
        <Text style={styles.emptyText}>No chats yet</Text>
      ) : (
        <View style={styles.card}>
          {chats.map((c, i) => (
            <View key={c.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open chat: ${c.title}`}
                style={({ pressed }) => [
                  styles.chatButton,
                  c.active && styles.chatButtonActive,
                  pressed && styles.chatButtonPressed,
                ]}
                onPress={() => onSelect(c.id)}
              >
                {c.active ? (
                  <Check size={16} color={chatC.primary} />
                ) : (
                  <MessageSquare size={16} color={chatC.mutedForeground} />
                )}
                <Text style={styles.chatTitle} numberOfLines={1}>
                  {c.title}
                </Text>
                <Text style={styles.chatSubtitle}>{c.subtitle}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete chat: ${c.title}`}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
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

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  emptyText: {
    paddingHorizontal: 16,
    paddingVertical: 64,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  chatButton: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chatButtonPressed: { backgroundColor: theme.colors.secondary },
  chatButtonActive: { backgroundColor: `${theme.colors.primary}1A` },
  chatTitle: { minWidth: 0, flex: 1, fontSize: 15, color: theme.colors.foreground },
  chatSubtitle: { fontSize: 12, color: theme.colors.mutedForeground },
  deleteButton: { height: 48, width: 48, alignItems: 'center', justifyContent: 'center' },
  deleteButtonPressed: { opacity: 0.6 },
}));
