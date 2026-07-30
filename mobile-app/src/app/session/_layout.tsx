import { Pressable, View } from 'react-native';
import { router, Stack, useNavigation } from 'expo-router';
import type { NativeStackHeaderItem } from 'expo-router/build/react-navigation/native-stack/types';
import { X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { useHeaderBase } from '@/components/header-buttons';
import { ChatComposerScope } from '@/components/chat/composer-host';
import { ChatHeaderRight, useChatHeaderItems } from '@/components/chat/chat-header';
import { startNewChat } from '@/lib/agent/provider';

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
// The header reads left-to-right as "leave / manage": CLOSE alone on the LEFT (plus
// the sheet's own swipe-down), and on the right the same joined history + new-chat
// pair the Chat tab carries, so the two chat surfaces have one set of controls in
// one place rather than the modal being the odd one out.
//
// One CONVERSATION, still: switching chats goes through the history sheet (pushed
// over this stack, see history/) and comes back as a chat id for this same screen —
// there is deliberately no chat list sitting UNDER the conversation. An earlier
// version anchored the Home hub below it so the header could carry a back chevron,
// which cost a second copy of the Home screen inside the modal and a fragile anchor
// dance to get it there (see the `withAnchor` note in lib/agent/chat-route.ts).

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

  // The modal's own Chats sheet — NOT the tab's, which would make the Chat tab
  // current underneath us (see history/index.tsx).
  const openHistory = () => router.push('/session/history');

  // NEW CHAT inside the modal: reuse-or-mint (`startNewChat` — a blank, untouched
  // chat is reused rather than piling up "New chat" rows in history), then re-point
  // this stack's single conversation screen at that id. `replace` rather than
  // `push` because the modal stays one screen deep — CLOSE remains the only way
  // out. `focus=1` opens the keyboard on arrival: asking for a new chat is asking
  // to type.
  const goNewChat = () => {
    const id = startNewChat();
    if (id) router.replace({ pathname: '/session/[id]', params: { id, focus: '1' } });
  };

  const closeItem: NativeStackHeaderItem = {
    type: 'button',
    label: '',
    icon: { type: 'sfSymbol', name: 'xmark' },
    accessibilityLabel: 'Close chat',
    onPress: close,
  };
  const chatItems = useChatHeaderItems({ onHistoryPress: openHistory, onNewChat: goNewChat });

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
            unstable_headerLeftItems: () => [closeItem],
            headerLeft: () => <CloseButton />,
            unstable_headerRightItems: () => chatItems,
            headerRight: () => (
              <ChatHeaderRight onHistoryPress={openHistory} onNewChat={goNewChat} />
            ),
          }}
        >
          {/* The conversation — the modal's only real screen. Everything above
              is its header. */}
          <Stack.Screen name="[id]" />

          {/* The Chats sheet, this stack's copy — a full-size formSheet (single
              detent: opens fully, swipe-down closes fully), matching the tab's.
              Its header + rows live in the nested history/_layout stack, so the
              header options above don't apply. A STATIC segment, so it wins the
              match against the sibling `[id]` route rather than being read as a
              chat called "history". */}
          <Stack.Screen
            name="history"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 24,
              headerShown: false,
            }}
          />
        </Stack>
      </View>
    </ChatComposerScope>
  );
}
