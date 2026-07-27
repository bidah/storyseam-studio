import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Layout for the fit-to-content formSheet pickers (model, image-model, option).
//
// These keep their native glass header, which floats over the content — so the
// content reserves HEADER_INSET up top to clear it. react-native-screens sizes
// a `fitToContents` sheet to `contentHeight + navBarHeight`, adding the nav-bar
// height (RNSScreen `contentHeightErrata`) to make room for the header. But with
// a glass header the content already sits *under* the bar, so that addition has
// nowhere to go up top and instead lands as dead space at the BOTTOM of the
// sheet (the white gap below the card).
//
// useSheetContentStyle cancels it: a negative bottom margin shrinks the measured
// content by the nav-bar height. 56 = the iOS modal nav-bar height react-native-
// screens both adds as errata and reports via getDefaultHeaderHeight's modal
// case (portrait iPhone/iPad); landscape's 32 doesn't apply to these sheets.
const HEADER_INSET = 76; // top reserve for the floating glass header
const HEADER_ERRATA = 56; // nav-bar height the fitToContents detent adds

/**
 * Content layout for a `fitToContents` formSheet with a floating glass header.
 *
 * `gap` is the visible breathing room you want BELOW the card — pass the
 * screen's own horizontal padding so the sheet's bottom margin reads the same
 * as its sides (32 for `px-8`, 16 for `px-4`).
 *
 * Beyond the nav-bar errata the sheet keeps its bottom safe area (34pt on a
 * home-indicator iPhone) below the content — measured as ~30pt of real space
 * under the card on an iPhone 17 Pro Max / iOS 26. That inset COUNTS toward the
 * gap instead of stacking on top of it; padding the full `gap` on top of it is
 * what made the bottom read as roughly double the sides (~51pt vs 27pt).
 * Clamped at 0 so a small gap never pushes the card under the home indicator;
 * on devices without one (iPad, Touch ID phones) `bottom` is ~0 and the whole
 * gap gets padded in as normal.
 */
export function useSheetContentStyle(gap: number) {
  const { bottom } = useSafeAreaInsets();
  return {
    paddingTop: HEADER_INSET,
    marginBottom: Math.max(gap - bottom, 0) - HEADER_ERRATA,
  };
}
