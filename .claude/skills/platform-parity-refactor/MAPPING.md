# Web → Mobile translation table

The web studio (`src/`, Vite + React) and the mobile app (`mobile-app/`, Expo 57)
talk to the **same Cloudflare Worker** (`worker/`). Port the front-end; the API is
already shared. When porting a feature, translate each concern below.

## Routing / navigation

| Web (`src/`) | Mobile (`mobile-app/src/`) |
|---|---|
| React Router v7 **data mode**, `src/router.jsx` + `src/routes/*.jsx` exporting `{ Component, loader }` | **expo-router** file-based routes under `app/` — tabs in `app/(tabs)/<name>/index.tsx`, a `_layout.tsx` per group |
| `loader` fetches data (SWR) | No loaders — components fetch with TanStack Query hooks (below) |
| `useNavigate()`, `useLoaderData()`, `useRevalidator()` | `router` / `useRouter()`, `<Link>` from `expo-router`; params via `useLocalSearchParams()` |
| Modal = shadcn `Dialog`/`Sheet` | Full-screen route or a `Sheet`-style overlay; presentation via route `_layout` options |
| A new tab = add route + tab button in `RootLayout` | A new tab = new folder under `app/(tabs)/` + entry in `app/(tabs)/_layout.tsx` |

## Data fetching & mutations

| Web | Mobile |
|---|---|
| `swr(...)` in a route loader, read via `useLoaderData()` | `useProjectResource('<key>')` from `src/lib/queries.ts` (add the endpoint to `RESOURCES` if new) |
| Post-mutation pair: `invalidateTabCache(key); revalidate()` | `const invalidate = useInvalidate(); … invalidate('<key>')` |
| `fetch('/api/…')` (Vite proxy) | `apiJson('/api/…')` / `apiFetch` from `src/lib/api.ts` (fetch-shim injects `x-project-id`, `x-client-id`, cookie) |
| Live sync: `/api/data/events` SSE firehose in `RootLayout` | `src/lib/sse.ts`; SSE events invalidate the `[projectId, …]` query scope |
| Current project via `ProjectProvider` | `useProjectStore` in `src/lib/project.ts` |

## UI primitives & styling

| Web | Mobile |
|---|---|
| `div`, `span`, `button`, `img` | `View`, `Text`, `Pressable`, `expo-image`'s `Image` (never raw DOM tags) |
| shadcn/ui `src/components/ui/*` | `mobile-app/src/components/ui/*` (`card`, `button`, `badge`, `input`, `segmented`, `empty`) — extend this set, mirroring an existing one, before hand-rolling |
| Tailwind v4 utility classes + `cn()` from `src/lib/utils.js` | **Unistyles v3** — `StyleSheet.create(theme => …)` from `react-native-unistyles`, passed as `style=`. There is no `className` and no `cn()` on mobile; theme colors come from `theme.colors.*` (palette in `mobile-app/src/unistyles.ts`) |
| In-file helpers `Empty`, `Panel`, `Chip`, `Spinner`, `ErrorNote` (`shared.jsx`) | `ui/empty`, `ui/card`, etc. — find the mobile analog, don't reimport web helpers |
| Text-only layout with CSS flex | RN flex (defaults differ: `flexDirection: 'column'`, no `display`); use `SafeAreaView`/`react-native-safe-area-context` for insets |

## Icons

`lucide-react` → **`lucide-react-native`** (same names). Still **no emojis or Unicode
glyphs** — import the named icon and render as a component with an explicit `size`.
Icon-only `Pressable` needs `accessibilityLabel`.

## Media

| Web | Mobile |
|---|---|
| `<video>` (+ `?v=` cache-bust nonce) | `expo-video` (`useVideoPlayer`, `<VideoView>`) |
| `<audio>` | `expo-audio` |
| `<img>` | `expo-image` `Image` |
| `toPreviewSrc`/blob URLs | Remote URLs through `apiUrl()`; downloads via `expo-file-system` |

## Agent / chat

| Web | Mobile |
|---|---|
| `src/components/AgentProvider.jsx`, `AgentChat.jsx` | `src/lib/agent/provider.tsx`, `chat-store.ts`, `messages.ts`; UI in `src/components/chat/*` |
| eve agent proxied at `/eve` | eve via `expo/fetch` streaming (see the mobile-app-architecture memory) |
| Script diff review, selection-ask | `src/components/story/script-review.tsx` (Script *editing* surface is limited on mobile) |

## Does NOT port

- **Editor** (`src/components/Editor.jsx`, Remotion) — excluded from the mobile port.
- **Script (TipTap)** rich editor — mobile has a read/review-oriented `story/script.tsx`, not the full editor.
- **Worker / backend changes** — already shared; no mobile-side work beyond calling the endpoint.

## Sanity checks after porting

- No `lucide-react` (web) import — must be `lucide-react-native`.
- No DOM tags (`div`, `<video>`, `window`, `document`, `localStorage`).
- Data reads go through `useProjectResource`; writes end with `useInvalidate`.
- `cd mobile-app && npx tsc --noEmit` passes.
- Any new Expo API was checked against `https://docs.expo.dev/versions/v57.0.0/`.
