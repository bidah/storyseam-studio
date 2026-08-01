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

// Cross-fade rather than a hard cut, now that what's underneath is a finished
// screen.
SplashScreen.setOptions({ duration: 350, fade: true });

let hidden = false;

export function splashReady() {
  if (hidden) return;
  hidden = true;
  SplashScreen.hideAsync().catch(() => {});
}
