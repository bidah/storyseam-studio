import { useEffect } from 'react';
import { create } from 'zustand';

// "This screen docks its own composer — stand the tab bar's agent accessory
// down while I'm up."
//
// The accessory already steps aside for the whole Chat tab (src/app/(tabs)/
// _layout.tsx), on the rule that one message bar at the bottom of the screen is
// enough. That rule can't be expressed as a tab elsewhere: Visual world is one
// segment INSIDE the Story tab, and Written world / Script / Shots all want the
// accessory. So the screen with the bar says so itself.
//
// A COUNT, not a boolean: two suppressing surfaces could overlap during a
// transition, and the last one to unmount must not clear a suppression the
// incoming one still wants.

type SuppressState = { count: number };

const useSuppressStore = create<SuppressState>(() => ({ count: 0 }));

/** Call from a screen that docks its own composer. Suppresses while mounted. */
export function useSuppressAgentAccessory() {
  useEffect(() => {
    useSuppressStore.setState((s) => ({ count: s.count + 1 }));
    return () => useSuppressStore.setState((s) => ({ count: Math.max(0, s.count - 1) }));
  }, []);
}

export function useAgentAccessorySuppressed(): boolean {
  return useSuppressStore((s) => s.count > 0);
}
