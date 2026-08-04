# Shot Studio Mobile

React Native (Expo SDK 57) companion to the shot-studio web app — same Worker
API, same eve chat agent, same feature set **except the Remotion editor**.
Architecture and per-screen specs: `docs/PLAN.md`.

## Run it

Native modules are used (keyboard-controller, enriched-markdown, secure-store,
video/audio, …), so **Expo Go won't work** — build a dev client:

```bash
npm install
npx expo run:ios          # or: npx expo run:android
```

By default the app talks to the deployed Worker
(`https://storyseam.app`). To point at a
local Worker instead, create `.env`:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3334
```

> The Worker must be deployed with the `@better-auth/expo` server plugin
> (worker/src/auth.js — added alongside this app) before mobile sign-in works
> against production.

## How it hangs together

- **Auth** — Better Auth email/password (+ "Sign in with Higgsfield" OAuth via
  deep link). The session cookie is persisted in SecureStore by
  `@better-auth/expo` and attached to every request by the fetch shim.
- **Fetch shim** (`src/lib/fetch-shim.ts`) — patches `global.fetch` for
  requests to the Worker origin: injects `Cookie`, `x-project-id`,
  `x-client-id`, and `x-eve-model` (on `/eve`), and routes streaming paths
  (`/eve/*`, SSE `/events`) through `expo/fetch` so NDJSON/SSE streaming works.
- **Chat** — the real `eve/react` `useEveAgent` against the Worker's `/eve`
  proxy; conversations persist to AsyncStorage; HITL input requests, tool
  chips, reasoning, and OAuth authorization cards render natively.
- **Data** — TanStack Query keyed `[projectId, resource]`; the Worker's SSE
  firehose (`/api/data/events`) invalidates the scope on any remote write, so
  agent-driven renders appear live. Pull-to-refresh everywhere.
- **Media** — relative payload URLs are absolutized with `?projectId=`
  (`mediaUrl`), grids use `/thumb/...`, video playback uses the 720p
  `/proxy/...` variants (`toPreviewSrc`).
- **Tabs** — native tab bar (Chat · Story · Episode · Cuts · Assets); pickers
  and settings are native formSheets.

## Not in this app (yet)

The Editor (Remotion timeline) — planned for a future session. Renders, cuts,
stitching, scoring, and trims are all driven through the chat agent instead.
