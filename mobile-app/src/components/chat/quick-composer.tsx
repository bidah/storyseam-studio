import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { create } from 'zustand';
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { setPendingDraft } from '@/lib/agent/pending-draft';
import { Composer, type LocalAttachment } from './composer';

// The accessory pill "morphing" into the real composer, IN PLACE. A
// UITabAccessory cannot hold a TextInput — nothing (UIKit or
// react-native-screens) lifts it for the keyboard, so a caret there would type
// from underneath it (see agent-accessory.tsx). The morph is therefore staged:
// tapping the pill flips `open`, the tab layout reads it and stands the
// accessory down, and THIS overlay — the same liquid-glass <Composer> every
// conversation uses, docked on the same bottom edge the pill occupied — fades
// in with the keyboard rising into place. One bar visually becomes the other.
//
// Sending is what mints the chat: the draft is parked in pending-draft (the
// same hand-off the landing screen's suggestion cards use) and the conversation
// screen is pushed; it dispatches the message once the shared flue session
// points at the new chat. Nothing is created on a tap that never sends.
//
// The overlay stays MOUNTED while closed (hidden, pointerEvents off), so a
// half-typed draft survives closing the pill and reopening it later.

type QuickComposerState = {
  open: boolean;
  /** Bumped per show() — remounts the input with autoFocus (see Composer). */
  tick: number;
  show: () => void;
  hide: () => void;
};

export const useQuickComposer = create<QuickComposerState>((set) => ({
  open: false,
  tick: 0,
  show: () => set((s) => ({ open: true, tick: s.tick + 1 })),
  hide: () => set({ open: false }),
}));

const noop = () => {};

// The overlay's bottom:0 is the WINDOW edge (it lives outside the tab
// navigator), so at rest the bar lifts by UIKit's tab bar height to sit where
// the pill sat. 49pt is the constant slice of the tab cluster: the measured
// inside-a-tab bottom inset (83pt) minus the window's own (34pt) — see
// lib/use-tab-bar-inset.ts for where those numbers come from.
const TAB_BAR_LIFT = 49;

export function QuickComposerOverlay() {
  const open = useQuickComposer((s) => s.open);
  const tick = useQuickComposer((s) => s.tick);
  const hide = useQuickComposer((s) => s.hide);
  const conv = useConversations();
  const fresh = useIsFreshChat();

  // Send = start the chat. Reuse the still-blank active chat (or mint one — the
  // same rule as the suggestion cards, so repeated sends don't pile up "New
  // chat" rows), park the message, and open the conversation; the dispatch
  // happens there because the shared flue session only repoints at the new chat
  // a render later (see lib/agent/pending-draft.ts).
  const onSubmit = useCallback(
    async (text: string, atts: LocalAttachment[]) => {
      const id: string = fresh && conv.activeId ? conv.activeId : conv.newChat();
      setPendingDraft(id, { text, attachments: atts });
      hide();
      router.navigate(`/(tabs)/chat/${id}`);
    },
    [conv, fresh, hide],
  );

  // Tap-outside = put the bar away (draft kept — see the mounted-while-closed
  // note above). The keyboard has to be dismissed explicitly: the input keeps
  // focus even as its bar fades out.
  const close = useCallback(() => {
    KeyboardController.dismiss();
    hide();
  }, [hide]);

  // The fade is on the SCRIM ONLY, never on a parent of the bar. The composer's
  // liquid glass is a UIVisualEffectView, and UIKit leaves undefined what one
  // renders inside a superview carrying an animated alpha — in practice it comes
  // up blank and STAYS blank once it has, so the bar arrives as bare text and
  // chips with no platter under them (seen on an iOS 26.4 sim; the conversation
  // screen's copy of the same <Composer>, whose host holds opacity at a constant
  // 1, renders its glass fine).
  //
  // So the closed bar is PARKED OFF-SCREEN with a translate instead. A transform
  // doesn't touch alpha, so the glass survives; and unlike `display:'none'` (the
  // first thing tried here) the view is never hidden, which matters because the
  // input is focused by remounting with `autoFocus` — iOS won't make a view that
  // was hidden in the same commit the first responder, and the keyboard silently
  // failed to open. Parking also keeps the bar MOUNTED, which is the whole
  // reason this overlay isn't conditionally rendered: a half-typed draft has to
  // survive close/reopen. No motion is lost — the keyboard is the motion,
  // carrying the bar up into the spot the pill just vacated.
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, fade]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
      {/* A light scrim behind the bar: it catches the tap-outside and steps the
          page back while composing. Not an accessibility element — the close
          affordance for a screen reader is the keyboard's own dismiss. */}
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]} pointerEvents="box-none">
        <Pressable
          accessible={false}
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onPress={close}
        />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, open ? null : styles.away]} pointerEvents="box-none">
        <Composer
          pending={false}
          busy={false}
          onStop={noop}
          onSubmit={onSubmit}
          focusTick={open ? tick : 0}
          restOffset={TAB_BAR_LIFT}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  // Parked off-screen, not hidden and not unmounted — see the note above.
  away: { transform: [{ translateY: 2000 }] },
});
