---
name: platform-parity-refactor
description: Port a feature that was just built in the web studio (src/, Vite + React) to the Expo mobile app (mobile-app/). Use after finishing or reviewing a web feature and the user wants the same capability on mobile — triggers include "port this to mobile", "platform parity", "reimplement on the app", "bring this to the mobile app", or "do the mobile version". Reads the source of truth (last commit, a PR, a PRD, or current conversation context), maps changed web files to their mobile equivalents, and reimplements respecting the mobile stack.
---

# Platform Parity Refactor

Reimplement a web-studio feature in the Expo mobile app. The backend is shared
(one Cloudflare Worker) — you are **porting UI + client behavior, not rebuilding
the API**. Same endpoints, new front-end idioms.

## Step 1 — Establish the source of truth

Ask/infer *which* feature to port and pull its actual spec. In priority order:

1. **Conversation context** — if the feature was just built in this session, use that.
2. **A commit** — `git show <sha> --stat` then `git show <sha> -- src/` for the web diff. Default to `HEAD` when the user says "the last feature / what we just did".
3. **A PR / PRD** — if the user names one, read it (`gh pr view`, or the PRD file).

Then list the web files that changed and read them fully. Do **not** start editing
mobile code until you can name every web file the feature touched and what each does.

## Step 2 — Classify each web change

- **Portable** — UI + client logic (a route/tab, a component, a data hook, a mutation). Port it.
- **Partial** — concept ports but implementation differs a lot (e.g. a `<video>` player → `expo-video`). Port the behavior, rewrite the mechanism.
- **Skip** — does not exist on mobile. The **Editor (Remotion)** and the **TipTap Script editor** surfaces are intentionally absent from the mobile port; backend/Worker changes are already shared and need no mobile work. Say explicitly what you're skipping and why.

## Step 3 — Map to the mobile stack

Read **[MAPPING.md](MAPPING.md)** for the full web→mobile translation table
(routing, data fetching, UI primitives, icons, media, styling, agent/chat). The
essentials:

- Routing: React Router v7 loaders → **expo-router** file routes under `mobile-app/src/app/(tabs)/…`; no loaders.
- Data: `swr` + `invalidateTabCache`/`revalidate` → **TanStack Query** via `src/lib/queries.ts` (`useProjectResource`, `useInvalidate`).
- UI: shadcn/ui + Tailwind + `div/button` → `mobile-app/src/components/ui/*` + **Unistyles v3** stylesheets (`style=`, never `className=`) on **`View/Text/Pressable`**.
- Icons: `lucide-react` → **`lucide-react-native`** (still no emojis/glyphs).
- Media: `<video>/<audio>` → **`expo-video`/`expo-audio`**.

## Step 4 — Reimplement

- Match the mobile app's existing conventions — read a sibling tab/component first and mirror it. Reuse `apiJson`, `useProjectResource`, `useInvalidate`, the `ui/*` primitives, and `src/lib/agent/*` rather than inventing parallels.
- **Expo has changed.** Per `mobile-app/AGENTS.md`, consult the exact versioned docs at `https://docs.expo.dev/versions/v57.0.0/` (via Context7 or WebFetch) before using any Expo API — do not code Expo from memory.
- Mobile is a **dev-build-only** app (not Expo Go); native modules are fine.

## Step 5 — Verify

- `cd mobile-app && npx tsc --noEmit` (the mobile app is TypeScript; the web app is JSX — types must actually pass).
- Confirm no `lucide-react` (web) import slipped in, no `className` anywhere (mobile is Unistyles-only — a `className` is a web habit that silently does nothing), no `StyleSheet` imported from `react-native` instead of `react-native-unistyles`, no web-only DOM (`div`, `<video>`, `window`, `localStorage`).
- Summarize what ported, what was adapted, and what was skipped.
