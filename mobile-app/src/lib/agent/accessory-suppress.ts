import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';

// "This screen docks its own composer — stand the tab bar's agent accessory
// down while I'm up."
//
// The accessory already steps aside for the Chat tab's conversation screen and
// for Visual world, on the rule that one message bar at the bottom of the screen
// is enough. That rule can't be expressed as a tab: Visual world is one segment
// INSIDE the Story tab, and Written world / Script / Shots all want the
// accessory. So the screen with the bar says so itself.
//
// Gated on FOCUS, not on being mounted. A pushed conversation stays mounted in
// the Home tab's stack when you leave for another tab, and a mount-scoped
// suppression therefore took the pill away from every OTHER tab for as long as
// that screen sat there — exactly where the pill is the only way back into the
// running session. Focus is the honest question: is a real composer on screen
// RIGHT NOW.
//
// A COUNT, not a boolean: two suppressing surfaces overlap during a transition
// (the incoming screen focuses before the outgoing one blurs), and the one
// standing down must not clear a suppression the incoming one still wants.

type SuppressState = { count: number };

const useSuppressStore = create<SuppressState>(() => ({ count: 0 }));

/**
 * Call from a screen that docks its own composer. Suppresses while focused.
 *
 * `enabled` is for a component rendered in two places — the conversation screen
 * lives both in the Home stack (suppress: its composer owns the bottom edge) and
 * inside the chat modal (don't: the accessory is covered by the modal anyway, and
 * removing it would re-lay the tab bar underneath and animate the pill back in on
 * dismiss).
 */
export function useSuppressAgentAccessory(enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      useSuppressStore.setState((s) => ({ count: s.count + 1 }));
      return () => useSuppressStore.setState((s) => ({ count: Math.max(0, s.count - 1) }));
    }, [enabled]),
  );
}

export function useAgentAccessorySuppressed(): boolean {
  return useSuppressStore((s) => s.count > 0);
}
