# Backend provider (React Native)

The **client connector seam**. The editor never talks to a transport directly:
every network/media interaction goes through an **EditorBackend** obtained with
`useBackend()`. The contract is a faithful copy of the web client backend, so the
same editor runs against any backend by swapping one impl.

> Web counterpart: `web-editor/src/providers/storage` · docs: `/docs/react-native/storage`

## Usage

Wrap the app once:

```tsx
import { BackendProvider } from "@/editor/providers/backend";
<BackendProvider>{/* <Editor /> */}</BackendProvider>
```

Inside any module:

```tsx
import { useBackend } from "@/editor/providers/backend";
const backend = useBackend();
const { timeline } = await backend.loadTimeline();
```

## The contract (`types.ts`)

| Method | Returns |
|---|---|
| `loadTimeline()` | `{ timeline, cuts }` |
| `saveTimeline(timeline)` | `{ ok, timeline }` |
| `loadCut(v)` | `{ timeline }` |
| `loadPool()` | `{ video, audio }` |
| `uploadMedia(file)` | `PoolItem` |
| `listStills()` | `Still[]` |
| `grabStill(image, meta)` | `Still` |
| `deleteStill(id)` | — |
| `render(options)` | `{ ok, jobId?, url?, error? }` |
| `pollRender(jobId)` | `{ status, url?, error? }` |
| `exportResolveUrl()` | href string |
| `mediaUrl(src)` / `previewUrl(src)` | URL string (parity with web) |
| **`resolveSource(src)`** | **`VideoSource`** — the one native addition |
| `subscribeTimeline(onForeignEdit)` | `unsubscribe()` |

## The seam

The only interface difference from web is **`resolveSource(src)`**: the web turns a
`src` into a URL string, but `expo-video` wants a `VideoSource` (a bundled
`require()` module id or `{ uri }`), so the contract adds it.

`createLocalBackend()` (`local.ts`) is the reference impl — the native analogue of
web's `cloudflare.js`. It runs the editor fully **offline on-device**, seeded with a
starter cut and a pool of **bundled clips**, and is the default when
`BackendProvider` gets no `backend` prop. Because the contract mirrors web, the
**same Cloudflare Worker** the web editor uses can back the native app via a custom
impl — no feature module changes.
