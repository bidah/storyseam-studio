import { router, Stack } from 'expo-router';
import { MenuButton, useHeaderBase, useMenuItem } from '@/components/header-buttons';
import { ChatHeaderRight, useChatHeaderItems } from '@/components/chat/chat-header';
import { ChatComposerScope } from '@/components/chat/composer-host';

// The Chat tab's stack. Two screens, and the split is the point:
//
//   index  — the LANDING screen (the Home tab's face). Recaps and starter
//            cards; the tab bar's agent pill is the typing surface here.
//   [id]   — one conversation, PUSHED on top of it.
//
// Pushing rather than swapping content in place is what buys the native header
// MORPH. Everything below is declared per-screen (here, not from inside the
// screen bodies) so UIKit knows both configurations before the transition
// starts and can animate between them instead of snapping after the fact:
//
//   left  — `headerBackVisible: true` sets UIKit's `leftItemsSupplementBackButton`,
//           so the system back chevron takes the corner and the shared menu item
//           SLIDES right of it rather than being replaced by it (the default:
//           left items and the back button are mutually exclusive).
//           `headerBackButtonDisplayMode: 'minimal'` keeps it a bare chevron —
//           otherwise it drags the previous screen's "Chat" title along and eats
//           the bar.
//   right — history alone on the landing screen, history + new chat on a
//           conversation. The shared item keeps its glass capsule across the
//           push; the new one fades in.
//   title — the landing screen paints its own big "Chat" headline in the scroll
//           content (the bar stays title-less), so pushing a conversation fades
//           the bar's title in rather than collapsing a large one.
//
// On Android/web there is no `leftItemsSupplementBackButton` equivalent —
// `headerLeft` REPLACES the back button — so the menu stands down on [id] and
// the back button gets the corner to itself.

const openHistory = () => router.push('/(tabs)/chat/history');

// "New chat" from inside a conversation = pop back to the landing screen — the
// home for starting one (the accessory pill there mints it, reusing a
// still-blank active chat). Nothing to disable, and the pop runs the header
// morph in reverse.
const goNewChat = () => router.dismissTo('/(tabs)/chat');

export default function ChatLayout() {
  const headerBase = useHeaderBase();
  const menuItem = useMenuItem();
  const homeItems = useChatHeaderItems({ onHistoryPress: openHistory });
  const chatItems = useChatHeaderItems({ onHistoryPress: openHistory, onNewChat: goNewChat });

  return (
    // The scope hosts the ONE composer for the whole stack, overlaid on it the
    // way the tab bar persists beneath it: pushing a conversation slides the
    // screen in under the bar instead of bringing a second bar along. Screens
    // register their handlers via useChatComposer (see composer-host.tsx).
    <ChatComposerScope>
    <Stack
      screenOptions={{
        ...headerBase,
        title: 'Chat',
        // Liquid-glass header (iOS 26). Three parts, all required:
        //   - `headerTransparent` → the native bar becomes translucent AND the
        //     screen is laid out UNDER it (edgesForExtendedLayout), so content
        //     actually passes behind the bar. Without content moving back there,
        //     glass has nothing to refract and reads as a flat tint.
        //   - the two transparent backgrounds override `useHeaderBase`'s solid
        //     `pageBg`, which is what kept the bar opaque. react-native-screens
        //     builds an OPAQUE appearance for any background whose alpha isn't 0
        //     — `headerStyle` feeds the standard appearance and `headerLargeStyle`
        //     the scroll-edge one (the bar at rest), so leaving either set keeps
        //     a solid bar in that state.
        //   - `scrollEdgeEffects.top` is the iOS 26 effect itself: the progressive
        //     blur/fade UIKit draws on the scroll view where it slides under the
        //     bar. 'soft' = soft-edged (no dividing line).
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerLargeStyle: { backgroundColor: 'transparent' },
        scrollEdgeEffects: { top: 'soft' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          // The big "Chat" headline is EMULATED in the screen body — a plain
          // Text in the scroll content wearing the large-title font — so it
          // scrolls away with the page like any other content. The bar itself
          // stays title-less to avoid doubling up with it.
          title: '',
          unstable_headerLeftItems: () => [menuItem],
          headerLeft: () => <MenuButton />,
          unstable_headerRightItems: () => homeItems,
          headerRight: () => <ChatHeaderRight onHistoryPress={openHistory} />,
        }}
      />

      {/* One conversation. Compact title: a transcript has no top to collapse
          against, and the stream reads better under a slim bar. The screen adds
          only its `title` (the chat's own) on top of this. */}
      <Stack.Screen
        name="[id]"
        options={{
          headerLargeTitle: false,
          headerBackVisible: true,
          headerBackButtonDisplayMode: 'minimal',
          unstable_headerLeftItems: () => [menuItem],
          unstable_headerRightItems: () => chatItems,
          headerRight: () => (
            <ChatHeaderRight onHistoryPress={openHistory} onNewChat={goNewChat} />
          ),
        }}
      />

      {/* A Discover poster, opened. Pushed like a conversation (back chevron,
          shared menu item), but title-less: the hero runs under the transparent
          bar and carries the name itself. The card that opened it ZOOMS into
          that hero — expo-router wires the transition through the href, so
          nothing here configures it beyond being a plain pushed screen. */}
      <Stack.Screen
        name="discover/[slug]"
        options={{
          title: '',
          headerLargeTitle: false,
          headerBackVisible: true,
          headerBackButtonDisplayMode: 'minimal',
          unstable_headerLeftItems: () => [menuItem],
        }}
      />

      {/* The Story showcase — the "Continue building your story" deck at one
          card per screen, flown out of the card that was tapped.

          An ordinary pushed screen, deliberately: the zoom is Expo Router's own
          (`Link.AppleZoom` on the card, `Link.AppleZoomTarget` on the poster
          over there), and it rides the HREF rather than this registration. So
          there is nothing to configure here beyond the chrome — and the native
          back chevron and swipe-back run the zoom in reverse for free.

          Title-less like the Discover poster it borrows the treatment from: the
          card that flies in carries its own headline, and a bar title would be
          a second one arriving over the top of it. */}
      <Stack.Screen
        name="showcase"
        options={{
          title: '',
          headerLargeTitle: false,
          headerBackVisible: true,
          headerBackButtonDisplayMode: 'minimal',
          unstable_headerLeftItems: () => [menuItem],
        }}
      />

      {/* Chat history — a full-size formSheet (single detent: opens fully,
          swipe-down closes fully). Its header + rows live in the nested
          history/_layout stack, so headerShown is off here — same pattern as
          the Settings sheet. Registered in this stack (not the root) so it
          renders inside <AgentProvider> and can read the conversation store. */}
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
    </ChatComposerScope>
  );
}
