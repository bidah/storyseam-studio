import { appThemes } from '../unistyles';
import { useEffectiveScheme, type Scheme } from './theme';

// Scheme-aware color source for the surfaces a unistyles stylesheet can't
// reach: lucide icon `color` props, the React Navigation theme, native SwiftUI
// Form backgrounds, and the native markdown renderer. Since the unistyles
// migration the values live in ONE place — the themes in src/unistyles.ts —
// and this module is a thin view over them keyed by the resolved scheme, so
// icons and stylesheets can never drift apart again.

export type Colors = (typeof appThemes)['dark']['colors'];

// Pure map — for imperative/module paths (e.g. building a nav theme).
export function getColors(scheme: Scheme): Colors {
  return appThemes[scheme].colors;
}

// Reactive — for component render paths (icon `color={...}` props, etc.).
export function useColors(): Colors {
  return getColors(useEffectiveScheme());
}
