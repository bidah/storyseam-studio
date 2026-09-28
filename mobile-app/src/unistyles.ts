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

// The web's design system (design.md + src/index.css), one palette per scheme.
// LIGHT is fal.ai's look and the web's default: white ground, zinc greys,
// hairline borders, ONE purple accent. DARK is design.md's "Battle Royale" HUD:
// near-black ground, one blood-orange accent. The web's borders are
// translucent (rgb … / 12%); they're pre-composited onto the page colour here
// because call sites append alpha suffixes to these hexes (`${border}99`), so
// every value must stay a 6-digit hex.

const darkColors: ThemeColors = {
  // Surfaces (--background #0B0C0F, --card #141619, --secondary #1C1F24)
  background: '#0b0c0f',
  pageBg: '#0b0c0f',
  groupedBg: '#0b0c0f',
  card: '#141619',
  surface: '#141619',
  surfaceAlt: '#1c1f24',
  secondary: '#1c1f24',
  accent: '#1c1f24',
  muted: '#1c1f24',
  input: '#373a3e', // --input rgb(122 126 133 / 40%) over the page
  border: '#27282d', // --border rgb(122 126 133 / 25%) over the page
  // Text / icon neutrals, most → least prominent
  foreground: '#f2f2f0',
  cardForeground: '#f2f2f0',
  secondaryForeground: '#f2f2f0',
  accentForeground: '#f2f2f0',
  destructiveForeground: '#f2f2f0',
  mutedForeground: '#7a7e85',
  subtleForeground: '#5f636a',
  // Brand / semantic — design.md's Tertiary is the sole interaction colour
  primary: '#ff5a1f',
  primaryForeground: '#0b0c0f',
  ring: '#ff5a1f',
  destructive: '#e5484d',
  success: '#3dd68c',
  warning: '#e8a33d',
  amber: '#e8a33d',
  info: '#38bdf8',
  // The send / mic / generate accent (named for its Higgsfield-lime past). It
  // is the brand accent now, so it follows `primary` — one accent per theme.
  higgsfield: '#ff5a1f',
  higgsfieldForeground: '#0b0c0f',
};

const lightColors: ThemeColors = {
  // Surfaces (--background #FFFFFF, --secondary/--muted #F4F4F5)
  background: '#ffffff',
  pageBg: '#ffffff',
  groupedBg: '#f4f4f5',
  card: '#ffffff',
  surface: '#f4f4f5',
  surfaceAlt: '#ffffff',
  secondary: '#f4f4f5',
  accent: '#f4f4f5',
  muted: '#f4f4f5',
  input: '#d4d4d5', // --input rgb(18 18 22 / 18%) over white
  border: '#e3e3e3', // --border rgb(18 18 22 / 12%) over white
  // Text / icon neutrals
  foreground: '#19191a',
  cardForeground: '#19191a',
  secondaryForeground: '#19191a',
  accentForeground: '#19191a',
  destructiveForeground: '#fafafa',
  mutedForeground: '#5b5b64',
  subtleForeground: '#787881',
  // Brand / semantic — fal's purple
  primary: '#681de4',
  primaryForeground: '#fafafa',
  ring: '#8553ff',
  destructive: '#dc2626',
  success: '#16a34a',
  warning: '#d97706',
  amber: '#d97706',
  info: '#0284c7',
  // See the dark palette: the old lime accent, now the brand purple.
  higgsfield: '#681de4',
  higgsfieldForeground: '#fafafa',
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
// `initialTheme` covers the frames before that effect runs: light, which is what
// the default preference is (the web's default too — dark is opted into).
StyleSheet.configure({
  settings: {
    initialTheme: () => 'light',
  },
  themes: appThemes,
  breakpoints,
});
