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
// SHEET_CONTENT_STYLE cancels it: a negative bottom margin shrinks the measured
// content by the nav-bar height, leaving BOTTOM_GAP of real breathing room so
// the sheet hugs its rows. 56 = the iOS modal nav-bar height react-native-
// screens both adds as errata and reports via getDefaultHeaderHeight's modal
// case (portrait iPhone/iPad); landscape's 32 doesn't apply to these sheets.
const HEADER_INSET = 76; // top reserve for the floating glass header
const HEADER_ERRATA = 56; // nav-bar height the fitToContents detent adds
const BOTTOM_GAP = 24; // breathing room we want below the card

export const SHEET_CONTENT_STYLE = {
  paddingTop: HEADER_INSET,
  marginBottom: BOTTOM_GAP - HEADER_ERRATA,
};
