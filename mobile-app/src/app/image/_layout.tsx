import { Pressable, View } from 'react-native';
import { router, Stack, useNavigation } from 'expo-router';
import type { NativeStackHeaderItem } from 'expo-router/build/react-navigation/native-stack/types';
import { X } from 'lucide-react-native';
import { useColors } from '@/lib/colors';
import { useHeaderBase } from '@/components/header-buttons';
import { AgentModeToggle } from '@/components/chat/agent-mode-toggle';

// THE IMAGE MODAL — visual world's generator, presented over whatever the user
// was doing. The picture-making twin of the chat modal (src/app/session/), and
// deliberately built the same way, down to the close button on the left.
//
// It used to be `Story › World › Visual world`: a native segmented control that
// put an image composer inside the tab whose other two thirds are prose, and made
// "generate a concept image" a tab switch plus two taps from anywhere else in the
// app. Reaching it now is one tap on the tab bar pill's Image icon, from any tab,
// and dismissing puts the author back exactly where they were.
//
// Why the route is at the ROOT and not in a tab: a modal presented from inside a
// tab's stack would have to make that tab current first — the exact cost this is
// meant to avoid. Being a root screen also means the tabs stay MOUNTED underneath
// (that's what a native modal does), so <AgentProvider> and the live-sync
// subscribers in the tab layout keep running while this is up.
//
// The header carries CLOSE on the left and the write/image toggle in the TITLE
// slot. The toggle is the same control the pill draws, and in a modal header it
// SWAPS modals rather than presenting a second one (agent-mode-toggle.tsx) — so
// "actually, let me just ask the agent" is one tap, without closing first.
//
// The option sheets this surface pushes (/option-picker, /image-model-picker,
// /library-picker, /generation) are ROOT routes, so they present over this modal
// rather than inside it — the same thing the chat composer's /model-picker does
// from inside the session modal.

export default function ImageLayout() {
  const headerBase = useHeaderBase();
  const colors = useColors();
  const navigation = useNavigation();

  // CLOSE = take the modal away. This is one screen of the ROOT stack, so the
  // dismissal belongs to that navigator — but which object `useNavigation()`
  // hands back in a layout component is not something to bet on (it can resolve
  // either to the root stack's entry for this modal or to the stack this file
  // renders). So ASK, with `canGoBack()`, instead of assuming. Same reasoning,
  // same code, as session/_layout.tsx.
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
    accessibilityLabel: 'Close visual world',
    onPress: close,
  };

  // Android/web fallback — no native bar button items there.
  const CloseButton = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close visual world"
      className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
      onPress={close}
    >
      <X size={19} color={colors.foreground} />
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          ...headerBase,
          title: 'Visual world',
          headerLargeTitle: false,
          // OPAQUE, unlike the chat modal's glass bar. The gallery is a
          // wall-to-wall grid of images with no leading margin of its own — it
          // came from a tab with a solid header and lays its own top padding out
          // against one, so a transparent bar would put the first row of
          // generations underneath the close button. The chat modal can afford
          // glass because a transcript's top edge is whitespace.
          unstable_headerLeftItems: () => [closeItem],
          headerLeft: () => <CloseButton />,
          // A React title (not a native one) because it's a control, not text.
          headerTitle: () => <AgentModeToggle variant="modal" />,
        }}
      >
        <Stack.Screen name="index" />
      </Stack>
    </View>
  );
}
