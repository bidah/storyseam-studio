import { useMemo } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// Theme preference (System / Dark / Light). Mirrors the persisted-store pattern
// in agent-model.ts: a zustand store written through to AsyncStorage, hydrated
// once on boot. `'system'` follows the OS appearance; the resolved `'dark'` |
// `'light'` value drives NativeWind (colorScheme.set) + React Navigation + the
// scheme-aware color source in src/lib/colors.ts.

export type ThemePref = 'system' | 'dark' | 'light';
export type Scheme = 'dark' | 'light';

// Dark is the product's historical default look, so an unset OS scheme (null /
// 'unspecified' on some devices) resolves to dark rather than light.
const FALLBACK_SCHEME: Scheme = 'dark';

// Narrow react-native's ColorSchemeName ('light' | 'dark' | null | undefined |
// 'unspecified') to our strict Scheme, applying the dark fallback.
function normalizeScheme(v: string | null | undefined): Scheme {
  return v === 'light' ? 'light' : v === 'dark' ? 'dark' : FALLBACK_SCHEME;
}

const STORAGE_KEY = 'shot-studio:theme';

function isPref(v: string | null | undefined): v is ThemePref {
  return v === 'system' || v === 'dark' || v === 'light';
}

type ThemeState = {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  pref: 'system',
  setPref: (pref) => {
    if (!isPref(pref)) return;
    set({ pref });
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  },
}));

export function getThemePref(): ThemePref {
  return useThemeStore.getState().pref;
}

// Reactive resolved scheme for component render paths. Reads the store's pref
// and, when it's `'system'`, the live OS color scheme (re-renders on change).
export function useEffectiveScheme(): Scheme {
  const pref = useThemeStore((s) => s.pref);
  const system = useColorScheme();
  return useMemo<Scheme>(() => {
    if (pref === 'system') return normalizeScheme(system);
    return pref;
  }, [pref, system]);
}

// Sync resolver for non-React / imperative reads.
export function getEffectiveScheme(): Scheme {
  const pref = useThemeStore.getState().pref;
  if (pref === 'system') return normalizeScheme(Appearance.getColorScheme());
  return pref;
}

// Push the preference down to UIKit as an app-wide `overrideUserInterfaceStyle`.
// Without this the JS theme and the *native* chrome disagree: nav bars, the
// SwiftUI `@expo/ui` Forms, alerts and the keyboard keep following the OS while
// only the RN-drawn surfaces flip. It also lets the large-title headers in the
// Settings / Chats sheets stay color-free — see `settings/_layout`, where any
// per-render header-config update makes react-native-screens drop the large
// title inside a formSheet, so the header must inherit its colors from here
// rather than be restyled from JS on every theme change.
export function applyNativeScheme(pref: ThemePref) {
  // `'unspecified'` clears the override and hands control back to the OS.
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

export function hydrateTheme(): Promise<void> {
  return AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isPref(v)) useThemeStore.setState({ pref: v });
    })
    .catch(() => {});
}
