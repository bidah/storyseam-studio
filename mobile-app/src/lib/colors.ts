import { useEffectiveScheme, type Scheme } from './theme';

// Scheme-aware color source. One place that maps the app's hardcoded dark hex
// palette to light equivalents, for the surfaces NativeWind classes can't reach:
// lucide icon `color` props, React Navigation theme, native SwiftUI Form
// backgrounds, and the native markdown renderer. Values mirror the HSL tokens in
// src/global.css (zinc base + emerald accent).
//
// Neutral tokens flip with the scheme; brand/semantic tokens (primary, reds,
// amber, info, higgsfield lime) read on both backgrounds and stay constant.

export type Colors = {
  // Surfaces (dark → light)
  pageBg: string; // the near-black / white page background
  surface: string; // cards, nav bar, headers
  surfaceAlt: string; // elevated / input fills
  muted: string; // subtle fills, code blocks
  border: string;
  // Text / icon neutrals, most → least prominent
  foreground: string;
  mutedForeground: string;
  subtleForeground: string;
  // Brand / semantic — constant across schemes
  primary: string;
  primaryForeground: string;
  destructive: string;
  amber: string;
  info: string;
  higgsfield: string;
  higgsfieldForeground: string;
};

// Brand/semantic colors that read on both light and dark backgrounds.
const BRAND = {
  primary: '#10b981',
  primaryForeground: '#ecfdf5',
  destructive: '#ef4444',
  amber: '#f59e0b',
  info: '#38bdf8',
  // Higgsfield brand — lime-yellow accent; near-black foreground for legibility.
  higgsfield: '#CBF74E',
  higgsfieldForeground: '#1a2e05',
} as const;

const DARK: Colors = {
  pageBg: '#0a0a0b',
  surface: '#111113',
  surfaceAlt: '#18181b',
  muted: '#27272a',
  border: '#27272a',
  foreground: '#fafafa',
  mutedForeground: '#a1a1aa',
  subtleForeground: '#71717a',
  ...BRAND,
};

const LIGHT: Colors = {
  pageBg: '#ffffff',
  surface: '#f4f4f5',
  surfaceAlt: '#ffffff',
  muted: '#f4f4f5',
  border: '#e4e4e7',
  foreground: '#18181b',
  mutedForeground: '#52525b',
  subtleForeground: '#71717a',
  ...BRAND,
};

// Pure map — for imperative/module paths (e.g. building a nav theme).
export function getColors(scheme: Scheme): Colors {
  return scheme === 'dark' ? DARK : LIGHT;
}

// Reactive — for component render paths (icon `color={...}` props, etc.).
export function useColors(): Colors {
  return getColors(useEffectiveScheme());
}
