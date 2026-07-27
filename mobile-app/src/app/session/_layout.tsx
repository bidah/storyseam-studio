import { Pressable, View } from 'react-native';
import { router, Stack, useNavigation } from 'expo-router';
import type { NativeStackHeaderItem } from 'expo-router/build/react-navigation/native-stack/types';
import { X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { useHeaderBase } from '@/components/header-buttons';
import { ChatComposerScope } from '@/components/chat/composer-host';

// The CHAT MODAL — the studio agent presented over whatever the user was doing.
//
// Why it exists: the tab bar's accessory pill has to reach the running session from
// every tab, and the conversation's other route lives in the Home tab's stack.
// Navigating there from Episode or Cuts would switch tabs, throwing away where the
// user was standing — the one thing the pill is meant to prevent. So everything
// that opens a chat opens this (see lib/agent/chat-route.ts); dismissing it puts
// the user back on their tab, untouched, and the conversation is the same shared
// flue session either way.
//
// Why the route is at the ROOT and not in a tab: a modal presented from inside a
// tab's stack would have to make that tab current first. Being a root screen also
// means the tabs stay MOUNTED underneath (that's what a native modal does), so
// <AgentProvider> — which lives in the tab layout — keeps running; this stack
// reaches its session through the mirror store in lib/agent/provider.tsx rather
// than through context.
//
// ONE screen, and one way out: the conversation, with CLOSE in the top right (plus
// the sheet's own swipe-down). There is deliberately no chat list underneath it —
// an earlier version anchored the Home hub below the conversation so the header
// could carry a back chevron, which cost a second copy of the Home screen inside
// the modal and a fragile anchor dance to get it there (see the `withAnchor` note
// in lib/agent/chat-route.ts). Switching chats is the Home tab's and the history
// sheet's job; this modal is for the conversation.

export default function SessionLayout() {
  const headerBase = useHeaderBase();
  const colors = useColors();
  const navigation = useNavigation();
  // CLOSE = take the modal away. The modal is one screen of the ROOT stack, so the
  // dismissal belongs to that navigator — but which object `useNavigation()` hands
  // back here is not something to bet on: a layout component is rendered as the
  // parent stack's screen, so it can resolve either to the root stack's entry for
  // this modal or to the stack this file renders. So ASK, with `canGoBack()`,
  // instead of assuming. (`goBack()` returns undefined whether or not it did
  // anything, which is what made an earlier `getParent()?.goBack() ?? goBack()`
  // wrong twice over: it fired both branches, and it couldn't tell that neither had
  // worked.)
  const close = () => {
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else if (navigation.canGoBack()) navigation.goBack();
    else router.back();
  };

  const closeItem: NativeStackHeaderItem = {
    type: 'button',
    label: '',
    icon: { type: 'sfSymbol', name: 'xmark' },
    accessibilityLabel: 'Close chat',
    onPress: close,
  };
  // Android/web fallback — no native bar button items there.
  const CloseButton = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close chat"
      className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
      onPress={close}
    >
      <X size={19} color={colors.foreground} />
    </Pressable>
  );

  return (
    // One composer for this stack, exactly as the Home tab's chat stack does it (see
    // composer-host.tsx). A SEPARATE scope from that one, so a draft typed here and
    // a draft typed there don't fight over a single bar.
    <ChatComposerScope>
      <View className="flex-1 bg-background">
        <Stack
          screenOptions={{
            ...headerBase,
            title: 'Chat',
            headerLargeTitle: false,
            // Liquid-glass header, same three ingredients as the chat tab's stack
            // (see (tabs)/chat/_layout.tsx for why each one is required): content
            // laid out UNDER a transparent bar, both appearances' backgrounds
            // cleared so react-native-screens doesn't build an opaque one, and the
            // iOS 26 scroll-edge effect for the blur where content slides under.
            headerTransparent: true,
            headerStyle: { backgroundColor: 'transparent' },
            headerLargeStyle: { backgroundColor: 'transparent' },
            scrollEdgeEffects: { top: 'soft' },
            unstable_headerRightItems: () => [closeItem],
            headerRight: () => <CloseButton />,
          }}
        />
      </View>
    </ChatComposerScope>
  );
}
