# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

Before debugging a known-looking symptom, check `docs/troubleshoot-solutions.md` —
a log of already-diagnosed bugs with root causes and shipped fixes (e.g. the
first-OAuth-login-bounces-to-sign-in race).

# Which build am I looking at?

Two different apps get called "the preview", and confusing them burns hours: a
**dev client** is a shell that loads JS from a Metro server (or its embedded
bundle) and shows the "Development servers" launcher; a **preview** build is the
real release app, no server, no launcher. They also listen to DIFFERENT update
channels, so an `eas update --channel preview` never reaches a dev client.

| script | what you get | channel | needs Metro? |
|---|---|---|---|
| `npm run ios` | dev client, compiled here by Xcode (SIMULATOR) | `development` | yes |
| `npm run ios:device` | dev client, compiled here by Xcode (DEVICE) | `development` | yes |
| `npm run build:dev` | dev client, built on EAS (device) | `development` | yes |
| `npm run build:dev:sim` | dev client for the SIMULATOR | `development` | yes |
| `npm run build:preview` | **release app, standalone** (device) | `preview` | **no** |
| `npm run ios:release` | **release app, compiled here by Xcode** (device) | none | **no** |
| `npm run update:preview` | OTA JS only — needs a preview BUILD installed | `preview` | no |

**Building locally means Xcode, never EAS.** `eas build --local` is still EAS —
same credential fetch, same image, same opinions, just billed to your fan. The
local path is `expo run:ios`, which is what `npm run ios` (Debug) and
`npm run ios:release` (Release) are. Reach for `build:*` only when you actually
want the build to happen on EAS.

Three traps:

- **A locally-built release app has NO update channel.** EAS Build is what
  injects `expo-channel-name` from the profile; `expo run:ios` has no profile to
  read, and `updates.requestHeaders` isn't set in app.json. So `ios:release`
  bakes in the JS that's in the tree and then never fetches an OTA. That is
  usually the point — it sidesteps the runtime-version dance entirely — but it
  means `update:preview` cannot reach it. Add `updates.requestHeaders` if you
  need one to keep receiving updates.
- **`update:preview` cannot fix a missing feature if no preview build exists.**
  The OTA lands on the channel and nothing consumes it. Check what's installed:
  `plutil -p <App>.app/Expo.plist | grep channel` — a dev client reports
  `expo-channel-name => development`.
- **The `preview` profile is `ios.simulator: false`**, so it cannot be installed
  on a simulator. For a standalone build on the sim you need a profile extending
  `preview` with `ios: { simulator: true }`.

An OTA also only applies on the SECOND launch (fetched on one, run on the next),
so a single relaunch showing old code is not evidence the update failed.

# Testing and debugging — drive the simulator with `agent-device`

A UI change is not verified until it has been LOOKED AT. `tsc` and the linter
say the code compiles, not that the button is legible on the artwork behind it —
so run it on the booted simulator and screenshot it.

**`agent-device` is the tool** (there's a skill of the same name; load it for the
full command set). It opens the app, reads the accessibility tree, presses
elements BY LABEL rather than by pixel, and screenshots — so a test reads
`press "Send to chat"` instead of a coordinate that the next layout change
invalidates. Prefer it over the computer-use MCP: no Simulator window is needed,
which is also the only thing that works in a headless session.

Two things it cannot do, and what to use instead:

- **Gestures that must reach React Native.** `agent-device gesture pan/swipe/
  pinch` does not drive RN ScrollViews or react-native-gesture-handler — taps and
  presses are fine, drags are not. Use `axe` (`brew install
  cameroncooke/axe/axe`): `axe swipe --start-x … --end-y … --duration 0.5 --udid
  <UDID>`, plus `--pre-delay 0.6` for a hold-then-drag.
- **Raw frames.** `xcrun simctl io booted screenshot <path>` is faster when all
  you want is the picture, and it's what to loop when capturing a cold start.

Getting a dev client onto Metro is a deep link, not a flag: start the bundler on
a port you have checked is free (other projects on this machine hold 8081/8082),
then
`xcrun simctl openurl <UDID> "mobileapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A<port>"`.
`agent-device open --metro-port` does NOT rebind an already-installed client.

# Styling — Unistyles v3, and nothing else

There is **no NativeWind and no Tailwind** in this app, and no `className`
anywhere. Styling is [Unistyles v3](https://www.unistyl.es/) end to end:

```tsx
import { StyleSheet } from 'react-native-unistyles'; // NEVER from 'react-native'

const styles = StyleSheet.create((theme) => ({
  card: { borderRadius: 16, backgroundColor: theme.colors.card },
}));
```

- **`src/unistyles.ts` is the palette and the config**, imported for its side
  effects by `index.js` before anything else. It is the ONLY place colors are
  defined — `src/lib/colors.ts` is a thin view over it, keyed by scheme, for the
  surfaces a stylesheet can't reach (lucide `color` props, the React Navigation
  theme, native SwiftUI Forms). Add a color there, not in a component.
- **`StyleSheet` always comes from `react-native-unistyles`.** It is API-compatible
  (`create`, `hairlineWidth`, `absoluteFill`, `flatten`), so the only visible
  difference is the import — but importing from `react-native` opts that file out
  of theming silently.
- **Conditionals compose as arrays** — `style={[styles.chip, active && styles.chipActive]}` —
  and press feedback is `style={({ pressed }) => [styles.btn, pressed && styles.pressed]}`.
  Never destructure or spread a stylesheet (`const { card } = styles` breaks it).
- **A variant key literally named `default` is the FALLBACK**, not a selectable
  name: `useVariants({ variant: v === 'default' ? undefined : v })`. Passing
  `'default'` by name is a type error (see `components/ui/button-base.tsx`).
- **The theme is DRIVEN, not adaptive.** `adaptiveThemes` is off on purpose:
  Unistyles resolves the scheme natively from `UIScreen.main.traitCollection` (the
  OS appearance) and cannot see the app-level override that the System/Dark/Light
  picker sets via `Appearance.setColorScheme()`. So `RootLayout` pushes the one
  resolved scheme to `UnistylesRuntime.setTheme()`. Turning adaptive themes back on
  would light the icons and leave the surfaces dark on a dark phone set to Light.
- **Third-party components need `withUnistyles`** to restyle on a theme change —
  the Babel plugin only auto-processes React Native core and Reanimated components.
  Today nothing needs it (every themed style lands on a core component), so if you
  hand a themed style to `expo-image`, `LinearGradient` or a `@legendapp/list`, you
  are the first — wrap it.
- **Unistyles is native code (Nitro).** Adding or upgrading it needs a rebuild;
  it can never ship as an OTA update.
