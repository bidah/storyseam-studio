import { getColors, useColors } from '@/lib/colors';
import type { Scheme } from '@/lib/theme';

// Concrete hex values for the chat surface tokens, needed by things that can't
// take NativeWind classes: lucide icon `color` props and the native markdown
// renderer's style object. Derived from the scheme-aware source (src/lib/colors)
// so chat follows the app theme. Use `useChatColors()` in components;
// `getChatColors(scheme)` for module-scope style factories.

export type ChatColors = {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  amber: string;
  // Higgsfield brand — lime-yellow accent; near-black foreground for legibility.
  higgsfield: string;
  higgsfieldForeground: string;
};

function toChatColors(c: ReturnType<typeof getColors>): ChatColors {
  return {
    background: c.pageBg,
    card: c.surface,
    foreground: c.foreground,
    muted: c.muted,
    mutedForeground: c.mutedForeground,
    border: c.border,
    primary: c.primary,
    primaryForeground: c.primaryForeground,
    destructive: c.destructive,
    amber: c.amber,
    higgsfield: c.higgsfield,
    higgsfieldForeground: c.higgsfieldForeground,
  };
}

export function getChatColors(scheme: Scheme): ChatColors {
  return toChatColors(getColors(scheme));
}

export function useChatColors(): ChatColors {
  return toChatColors(useColors());
}
