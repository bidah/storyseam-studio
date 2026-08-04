import { Appearance } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

// The app's single color source of truth, replacing the two parallel palettes
// that existed before the unistyles migration: the shadcn HSL variables in
// global.css (NativeWind classes) and the hex map in src/lib/colors.ts (icon
// props, nav theme, native surfaces). The two had drifted a shade apart in a
// few places (destructive, warning, info); this map unifies on the hex palette
// the native chrome already showed, zinc base + emerald accent, dark default.
//
// Aliases on purpose: `background`/`pageBg`, `card`/`surface` point at the same
// value — the first name is what migrated tailwind classes said, the second is
// what the old Colors consumers (src/lib/colors.ts) say. Both survive so no
// call site has to translate.

// Named rather than inferred from the dark palette: `as const` would infer each
// value as its own literal type, and the light palette would then have to repeat
// the dark hexes to satisfy it.
type ThemeColors = {
  // Surfaces
  background: string;
  pageBg: string;
  groupedBg: string;
  card: string;
  surface: string;
  surfaceAlt: string;
  secondary: string;
  accent: string;
  muted: string;
  input: string;
  border: string;
  // Text / icon neutrals, most → least prominent
  foreground: string;
  cardForeground: string;
  secondaryForeground: string;
  accentForeground: string;
  destructiveForeground: string;
  mutedForeground: string;
  subtleForeground: string;
  // Brand / semantic
  primary: string;
  primaryForeground: string;
  ring: string;
  destructive: string;
  success: string;
  warning: string;
  amber: string;
  info: string;
  higgsfield: string;
  higgsfieldForeground: string;
};

const darkColors: ThemeColors = {
  // Surfaces
  background: '#0a0a0b',
  pageBg: '#0a0a0b',
  groupedBg: '#0a0a0b',
  card: '#111113',
  surface: '#111113',
  surfaceAlt: '#18181b',
  secondary: '#27272a',
  accent: '#27272a',
  muted: '#27272a',
  input: '#27272a',
  border: '#27272a',
  // Text / icon neutrals, most → least prominent
  foreground: '#fafafa',
  cardForeground: '#fafafa',
  secondaryForeground: '#fafafa',
  accentForeground: '#fafafa',
  destructiveForeground: '#fafafa',
  mutedForeground: '#a1a1aa',
  subtleForeground: '#71717a',
  // Brand / semantic — constant across schemes (read on both backgrounds)
  primary: '#10b981',
  primaryForeground: '#ecfdf5',
  ring: '#10b981',
  destructive: '#ef4444',
  success: '#34d399',
  warning: '#f59e0b',
  amber: '#f59e0b',
  info: '#38bdf8',
  higgsfield: '#CBF74E',
  higgsfieldForeground: '#1a2e05',
};

const lightColors: ThemeColors = {
  // Surfaces
  background: '#ffffff',
  pageBg: '#ffffff',
  groupedBg: '#f2f2f7',
  card: '#ffffff',
  surface: '#f4f4f5',
  surfaceAlt: '#ffffff',
  secondary: '#f4f4f5',
  accent: '#f4f4f5',
  muted: '#f4f4f5',
  input: '#e4e4e7',
  border: '#e4e4e7',
  // Text / icon neutrals
  foreground: '#18181b',
  cardForeground: '#18181b',
  secondaryForeground: '#18181b',
  accentForeground: '#18181b',
  destructiveForeground: '#fafafa',
  mutedForeground: '#52525b',
  subtleForeground: '#71717a',
  // Brand / semantic
  primary: '#10b981',
  primaryForeground: '#ecfdf5',
  ring: '#10b981',
  destructive: '#ef4444',
  success: '#10b981',
  warning: '#f59e0b',
  amber: '#f59e0b',
  info: '#38bdf8',
  higgsfield: '#CBF74E',
  higgsfieldForeground: '#1a2e05',
};

export const appThemes = {
  dark: { colors: darkColors },
  light: { colors: lightColors },
};

// Phone-first app; breakpoints exist for the occasional tablet/landscape check.
const breakpoints = {
  xs: 0,
  sm: 380,
  md: 768,
  lg: 1024,
} as const;

type AppThemes = typeof appThemes;
type AppBreakpoints = typeof breakpoints;

// The empty bodies are the point: this is unistyles' typing handshake, teaching
// its generic `theme` / breakpoint parameters the shapes declared above. An
// interface is required (a type alias can't merge into the module), so the
// "declares no members" lint is unavoidable here rather than a smell.
declare module 'react-native-unistyles' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesThemes extends AppThemes {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

// NOT adaptive themes — the app's theme is DRIVEN, from src/lib/theme.ts.
//
// `adaptiveThemes: true` would look right and be subtly wrong here. Unistyles
// resolves the scheme natively from `UIScreen.main.traitCollection`, which is
// the OS-level appearance; React Native's `Appearance.setColorScheme()` — what
// the System/Dark/Light picker calls to bend the native chrome — overrides the
// app's WINDOWS, not the screen. So an author on a dark phone choosing Light
// would get light icons and nav chrome over dark unistyles surfaces.
//
// Instead RootLayout pushes the one resolved scheme (`useEffectiveScheme()`) to
// `UnistylesRuntime.setTheme()`, so every surface reads from the same decision.
// `initialTheme` covers the frames before that effect runs: the OS scheme, which
// is what the default `'system'` preference resolves to anyway.
StyleSheet.configure({
  settings: {
    initialTheme: () => (Appearance.getColorScheme() === 'light' ? 'light' : 'dark'),
  },
  themes: appThemes,
  breakpoints,
});
