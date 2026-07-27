import { Pressable, View } from 'react-native';
import type { NativeStackHeaderItem } from 'expo-router/build/react-navigation/native-stack/types';
import { History, SquarePen } from 'lucide-react-native';
import { useChatColors } from './theme';

// Right-side controls for the Chat tab's native header. The set MORPHS with the
// stack: the landing screen carries history alone, and pushing a conversation
// adds new chat beside it. Both screens declare the shared history item, so
// UIKit carries that bar button item across the push transition (its iOS 26
// glass capsule interpolates) and only fades the new one in — which is the whole
// reason the two screens declare items rather than one screen swapping them.
//
// The project switcher sits on the left (shared, see header-buttons.tsx); the
// model selector lives in the composer, next to the attach button.
//
// iOS gets native bar button items so the navigation bar's own glass capsule IS
// the button chrome (see header-buttons.tsx for why); Android/web falls back to
// the <Pressable> row below.

type ChatHeaderProps = {
  onHistoryPress: () => void;
  /**
   * Omitted on the landing screen — that screen IS the new chat, so the control
   * would do nothing there. (It used to ship disabled; a route that doesn't
   * render it beats a button greyed out on arrival.)
   */
  onNewChat?: () => void;
};

export function useChatHeaderItems({
  onHistoryPress,
  onNewChat,
}: ChatHeaderProps): NativeStackHeaderItem[] {
  const items: NativeStackHeaderItem[] = [
    {
      type: 'button',
      label: '',
      icon: { type: 'sfSymbol', name: 'clock.arrow.circlepath' },
      accessibilityLabel: 'Chat history',
      onPress: onHistoryPress,
    },
  ];
  if (onNewChat) {
    items.push({
      type: 'button',
      label: '',
      icon: { type: 'sfSymbol', name: 'square.and.pencil' },
      accessibilityLabel: 'New chat',
      onPress: onNewChat,
    });
  }
  return items;
}

// Android/web fallback for useChatHeaderItems.
export function ChatHeaderRight({ onHistoryPress, onNewChat }: ChatHeaderProps) {
  const c = useChatColors();
  return (
    <View className="flex-row items-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chat history"
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
        onPress={onHistoryPress}
      >
        <History size={18} color={c.mutedForeground} />
      </Pressable>

      {onNewChat ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
          onPress={onNewChat}
        >
          <SquarePen size={18} color={c.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}
