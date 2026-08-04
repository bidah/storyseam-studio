import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { NativeStackHeaderItem } from 'expo-router/build/react-navigation/native-stack/types';
import { History, SquarePen } from 'lucide-react-native';
import { useChatColors } from './theme';

// Right-side controls for every chat header — the Chat tab's stack and the chat
// modal (src/app/session/) both draw this pair. The set MORPHS with the stack:
// the landing screen carries history alone, and pushing a conversation adds new
// chat beside it. Both screens declare the shared history item, so UIKit carries
// that bar button item across the push transition (its iOS 26 glass capsule
// interpolates) and only fades the new one in — which is the whole reason the two
// screens declare items rather than one screen swapping them.
//
// The two read as ONE joined control, not two floating buttons: `sharesBackground`
// is iOS 26's `UIBarButtonItem.sharesBackground`, which puts adjacent items inside
// a single glass capsule with a hairline between them. The fallback below mirrors
// that with a bordered pill, so the pair looks the same everywhere.
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
      sharesBackground: true,
      onPress: onHistoryPress,
    },
  ];
  if (onNewChat) {
    items.push({
      type: 'button',
      label: '',
      icon: { type: 'sfSymbol', name: 'square.and.pencil' },
      accessibilityLabel: 'New chat',
      sharesBackground: true,
      onPress: onNewChat,
    });
  }
  return items;
}

// Android/web fallback for useChatHeaderItems. One button stands alone as a round
// tap target; two are JOINED into a single bordered pill split by a hairline —
// the stand-in for the shared glass capsule iOS draws for `sharesBackground`.
export function ChatHeaderRight({ onHistoryPress, onNewChat }: ChatHeaderProps) {
  const c = useChatColors();
  const history = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Chat history"
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      onPress={onHistoryPress}
    >
      <History size={18} color={c.mutedForeground} />
    </Pressable>
  );

  if (!onNewChat) {
    return <View style={styles.row}>{history}</View>;
  }

  return (
    <View style={styles.pill}>
      {history}
      <View style={styles.divider} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        onPress={onNewChat}
      >
        <SquarePen size={18} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  divider: {
    height: 20,
    width: 1,
    backgroundColor: theme.colors.border,
  },
  btn: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
}));
