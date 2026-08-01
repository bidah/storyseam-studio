import * as SplashScreen from 'expo-splash-screen';

// The splash comes down ONCE, and only when there is a real screen behind it to
// come down onto.
//
// "Real" is the whole point. The root route (`app/index.tsx`) is a pure
// redirect — it renders null, then sends the app to (tabs) or /sign-in. Lifting
// the splash on the ROOT view's first layout, which is what this used to do,
// uncovered precisely that nothing: a white gap, with the actual screen sliding
// in afterwards. The boot gate (lib/boot.ts) had already done the waiting; the
// lift was just aimed at the wrong frame.
//
// So the LANDING screens say when they're up — (tabs) and /sign-in, whichever
// the redirect picks — and the root layout arms a fallback in case neither ever
// does. First caller wins; the rest are no-ops.

let hidden = false;

export function splashReady() {
  if (hidden) return;
  hidden = true;
  // Cross-fade rather than a hard cut — worth it now that what's underneath is a
  // finished screen. Set HERE, immediately before the hide, not once at module
  // scope: the native side reads these options at hide() time
  // (SplashScreenManager.swift), and a dev client re-shows the splash on every
  // bundle reload, so a single early call doesn't reliably survive to the frame
  // that matters. Measured — set at module scope only, the transition was a
  // one-frame cut; set here, it ramps across ~10 frames.
  SplashScreen.setOptions({ duration: 350, fade: true });
  SplashScreen.hideAsync().catch(() => {});
}
