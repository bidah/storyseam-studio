// Platform seam for the Electron desktop app. The preload
// (desktop/preload/index.cjs) injects `window.desktop` before any page script
// runs; on the web it simply doesn't exist, so every desktop affordance hangs
// off these two exports and the web build is untouched.
export const desktop = typeof window !== "undefined" ? window.desktop : undefined;
export const isDesktop = !!desktop;
