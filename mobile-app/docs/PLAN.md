# Shot Studio Mobile — Execution Plan

React Native (Expo SDK 57) port of the shot-studio web app with the **same feature
set except the Editor** (Remotion timeline — future session). Talks to the same
deployed Cloudflare Worker API and the same eve chat agent.

## Reference codebases

- **Web app**: `/Users/rofi/Programing/shot-studio/src` — feature source of truth.
- **Worker API**: `/Users/rofi/Programing/shot-studio/worker` — endpoints + auth.
- **Chat kit donor**: `/Users/rofi/Programing/expo-ai-chatbot-lite-and-pro/expo-ai-chatbot-pro/expo-ai-chatbot/`
  — same Expo SDK 57 / RN 0.86; we lift its chat UI patterns (composer, keyboard
  handling, streaming markdown, formSheet model picker, NativeWind setup).

## Architecture decisions

1. **Backend unchanged** — the app is a pure client of the existing Worker
   (`EXPO_PUBLIC_API_URL`, default `https://shot-studio-uploads.rodrigofigueroa-name.workers.dev`).
   One Worker change only: Better Auth gets the `@better-auth/expo` server plugin +
   `mobileapp://` (and dev `exp://`) trusted origins.
2. **Auth** — Better Auth email/password via `@better-auth/expo` client plugin
   (cookie persisted in SecureStore). Every API request manually attaches
   `Cookie: authClient.getCookie()` with `credentials:"omit"`. Higgsfield OAuth
   (genericOAuth `providerId:"higgsfield"`) via deep link is wired best-effort on
   the sign-in screen.
3. **Headers shim (port of `src/lib/projectFetch.js`)** — a patched `global.fetch`
   that, for requests to the API origin only: uses **`expo/fetch`** (streaming-capable,
   required by the eve NDJSON stream), injects `x-project-id`, `x-client-id`,
   `x-eve-model` (only on `/eve` paths), and `Cookie` (if not already set).
   All other requests pass through untouched. This one shim makes the `eve` SDK,
   better-auth, and every query work without threading headers everywhere.
4. **Chat = real eve SDK** — `useEveAgent` from `eve/react` (v0.20, same as web),
   `host: API_ORIGIN + ""` with paths under `/eve` proxied by the Worker. Verified:
   the eve client uses plain fetch + `body.getReader()` NDJSON — no browser-only APIs.
   Conversations persist to AsyncStorage (port of `src/lib/chat-store.js` +
   `AgentProvider.jsx`; the UI-driven agent message templates are ported verbatim
   in `src/lib/agent/messages.ts`).
5. **Data** — TanStack Query. Route loaders/swr from web map to query keys; the
   SSE firehose (`/api/data/events?projectId=`) invalidates keys by `resource`;
   own writes are echo-suppressed via `x-client-id`. Reconnect ⇒ invalidate all
   (the DO has no replay buffer). Pull-to-refresh everywhere. SSE is consumed with
   `expo/fetch` streaming (no EventSource in RN).
6. **Media** — relative URLs from payloads (`/gen/..`, `/sound-media/..`, `/asset/..`,
   `/thumb/..`, `/stills/..`, `/storyboard-media/..`) resolve via
   `mediaUrl(rel)` = `API_ORIGIN + rel + "?projectId=<pid>"` (media elements can't
   send headers; Worker accepts the query param). Use `/thumb/<rel>` for grids and
   the `/proxy/...` 720p variants for video previews (`previewSrc` port). Images:
   `expo-image`; video: `expo-video`; audio: `expo-audio`.
7. **Styling** — NativeWind 4.1.23 + Tailwind 3.4 (proven combo in the donor
   project on this exact SDK). Theme tokens = shadcn-style HSL vars with
   **zinc base + emerald accent, dark default** to match the web app. Icons:
   `lucide-react-native` only (no emojis) — same rule as web. SF Symbols allowed
   only in the native tab bar.
8. **Native UI first** — NativeTabs (iOS 26 native tab bar, already in scaffold),
   expo-router `formSheet` presentations for pickers/editors (no JS bottom-sheet lib),
   `@expo/ui` menus/pickers where they fit, `expo-glass-effect` composer surface,
   `expo-haptics` on selections/sign-offs, native context menus for long-press actions.

## Navigation (expo-router)

```
src/app/
  _layout.tsx                 # polyfills, providers (Query, Keyboard, Auth, Project, Agent, Theme), Stack
  (auth)/sign-in.tsx          # + sign-up.tsx — Better Auth email/password (+ HF OAuth button)
  (tabs)/_layout.tsx          # NativeTabs: chat · story · episode · cuts · assets
  (tabs)/chat.tsx             # eve agent chat (default tab)
  (tabs)/story.tsx            # segmented: World | Script | Shot List
  (tabs)/episode/index.tsx    # bundle list
  (tabs)/episode/[bundleId].tsx  # bundle detail (push)
  (tabs)/cuts.tsx
  (tabs)/assets.tsx           # segmented: Library | Sounds
  projects.tsx                # formSheet — switch/create/rename projects
  settings.tsx                # formSheet — account, sign out
  model-picker.tsx            # formSheet — agent model (sonnet-5 / opus-4.6 / fable-5)
  viewer.tsx                  # full-screen media viewer (image zoom / video)
  library-picker.tsx          # formSheet — pick image(s) from library (used by World + Episode)
  sound-picker.tsx            # formSheet — pick a liked voice take (World characters)
```

Header (each tab): project name → opens `/projects`; right: refresh + settings.

## Core lib (src/lib)

- `env.ts` — `API_ORIGIN` from `process.env.EXPO_PUBLIC_API_URL` (fallback prod URL).
- `client-id.ts` — per-launch UUID.
- `fetch-shim.ts` — global fetch patch described above (installed once from root layout, before anything).
- `auth-client.ts` — `createAuthClient` + `expoClient({scheme:"mobileapp", storage: SecureStore})` + `genericOAuthClient()`.
- `project.ts` — zustand store: `projectId` (AsyncStorage-persisted), setter also POSTs `/api/projects/:id/activate`; project switch clears the query cache.
- `agent-model.ts` — port of web `agentModel.js` on AsyncStorage (`claude-sonnet-5` default, `claude-opus-4.6`, `claude-fable-5`).
- `api.ts` — `apiFetch/apiJson` (relative path → API_ORIGIN), `mediaUrl(rel)`, `thumbUrl(rel)`, `previewSrc(url)`.
- `sse.ts` — `useProjectEvents(onEvent)`: streams `/api/data/events`, reconnect w/ backoff + AppState resume, invalidates on reconnect.
- `queries.ts` — query keys + hooks per resource: `world`, `script`, `shotlist`, `packs`, `episode`, `final`, `audio`, `storyboard`, `cuts`, `library`, `sounds`, `projects`, `hfImages` (infinite); mutations mirror web endpoints and `invalidate` their key on success (the canonical web pair `invalidateTabCache(key); revalidate()` becomes `queryClient.invalidateQueries`).
- `agent/provider.tsx` — port of `AgentProvider.jsx` (session runner keyed by chat id, conversations in AsyncStorage, `agentIsBusy`).
- `agent/messages.ts` — verbatim port of the message-builder templates (`renderSoundMessage`, `renderEpisodeMessage`, `renderStoryboardMessage/AllMessage`, `createWorldMessage`, `generateShotListMessage`, `stitchCutMessage`, `scoreCutMessage`, `trimMessage`, `renderAllPendingMessage`).

## Screen specs (web parity, mobile-native form)

- **Chat** — donor-project UI: FlatList, right-aligned user bubbles, assistant
  markdown via `react-native-enriched-markdown` + `remend` (streaming), tool-call
  chips, collapsible reasoning, HITL `inputRequest` cards (option buttons or
  free-text redirect — `agent.send({inputResponses:[...]})`), authorization cards
  (open URL via `expo-web-browser`), image attachments (picker → `POST /api/upload`
  → image part), composer with `KeyboardStickyView` + glass surface, stop button
  while busy, conversations list + new chat, model pill → `/model-picker`.
- **World** — sections: Title/Logline, Story Map (5 fields), Story Depth (5 fields)
  — tap to edit in place (save-on-blur → `PUT /api/world`); characters as cards
  (sheet image, archetype/want/need/traits/arc/voice/appearance) with edit sheet,
  link sheet-image via `/library-picker`, attach voice via `/sound-picker`;
  "Create the world" button → agent (`createWorldMessage`).
- **Script** — native screenplay renderer of the ProseMirror JSON (scene-heading
  uppercase-bold, character centered-caps, dialogue indented, parenthetical italic,
  transition right-aligned); title editable; drafts menu (switch/pin/rename/delete);
  sign/unsign (`POST /api/script/sign`); pending proposal banner → review screen
  with before/after and accept/reject; "Generate shot list" (gated on signed) → agent.
  Body text editing stays agent-driven on mobile (proposals), not TipTap.
- **Shot List** — beat-grouped list; pack chips (horizontal) filter; shot row →
  edit sheet (location/characters/camera/action/dialogue/audioSync/dur/prompt →
  `PUT /api/shotlist/shot/:n`); "rebuild from episode" action.
- **Episode** — bundle cards (id, beat, duration, sign-off pills, selected take
  thumb). Detail: Images|Video segmented; Video mode: prompt sections (restrictions/
  style/directives per-shot, debounced `POST /api/episode/prompt`), image-ref grid
  (+ `/library-picker`, auto-assign button), audio refs, three sign-off rows
  (images/prompt/audio → `POST /api/episode/sign`), Render (gated on full sign-off)
  → agent; takes carousel (expo-video, select → `POST /api/episode/video-select`,
  trim sheet → agent `trimMessage`). Images mode: per-shot stills grid, select
  (`POST /api/storyboard/select`), "Render still"/"all stills" → agent.
- **Cuts** — latest generation player (expo-video), segments strip (tap = seek),
  music cue markers, Stitch/Score buttons → agent, history sheet (versions,
  play any), share via expo-sharing.
- **Library** — folders grid → image grid (thumbs); tap = viewer; long-press
  context menu (toggle final-selection, rename, delete); segmented second view
  "Import from Higgsfield": infinite grid of HF generations → import into folder.
- **Sounds** — Music|SFX|Voice segments; track cards listing versions: prompt,
  status badge (ready/pending), like heart, inline audio player, edit sheet
  (prompt/name/duration → new version or in-place), delete; create-track sheet
  per kind; Render buttons (per pending version + render-all) → agent.
- **Projects** — list + create + rename + activate (`POST /api/projects/:id/activate`);
  switching sets store, clears query cache, resets chat to a fresh conversation.

## Dependencies to add (mobile-app)

nativewind@4.1.23, tailwindcss@^3.4, tailwind-merge, clsx, class-variance-authority,
react-native-keyboard-controller, eve@^0.20, @tanstack/react-query, better-auth@^1.6.23,
@better-auth/expo, expo-secure-store, @react-native-async-storage/async-storage,
lucide-react-native, react-native-svg, react-native-enriched-markdown, remend,
zustand, expo-video, expo-audio, expo-image-picker, expo-haptics, expo-sharing,
sonner-native, @stardazed/streams-text-encoding, @ungap/structured-clone.

Native modules present ⇒ **dev build required** (`npx expo run:ios` / EAS), not Expo Go.

## Order of work

1. Foundation config + theme (this repo's `mobile-app/`)
2. Core lib plumbing
3. Worker Better-Auth expo plugin
4. Shell: auth, tabs, projects, settings
5. Chat surface
6. Story / Episode / Cuts / Assets screens (parallel)
7. Integration pass: `tsc --noEmit` + `expo export` clean; polish (haptics, empty
   states, pull-to-refresh); README.

Out of scope this session: Editor (Remotion timeline), push notifications, offline.
