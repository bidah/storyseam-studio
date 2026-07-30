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
| `npm run ios` | dev client, compiled here by Xcode | `development` | yes |
| `npm run build:dev` | dev client, built on EAS (device) | `development` | yes |
| `npm run build:dev:sim` | dev client for the SIMULATOR | `development` | yes |
| `npm run build:preview` | **release app, standalone** (device) | `preview` | **no** |
| `npm run build:preview:local` | same artifact, compiled on this Mac | `preview` | **no** |
| `npm run update:preview` | OTA JS only — needs a preview BUILD installed | `preview` | no |

Two traps:

- **`update:preview` cannot fix a missing feature if no preview build exists.**
  The OTA lands on the channel and nothing consumes it. Check what's installed:
  `plutil -p <App>.app/Expo.plist | grep channel` — a dev client reports
  `expo-channel-name => development`.
- **The `preview` profile is `ios.simulator: false`**, so it cannot be installed
  on a simulator. For a standalone build on the sim you need a profile extending
  `preview` with `ios: { simulator: true }`.

An OTA also only applies on the SECOND launch (fetched on one, run on the next),
so a single relaunch showing old code is not evidence the update failed.
