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

export function hydrateTheme() {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isPref(v)) useThemeStore.setState({ pref: v });
    })
    .catch(() => {});
}
