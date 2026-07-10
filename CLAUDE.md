# shot-studio

Vite + React front-end (`src/`, port 3333) backed by a Cloudflare Worker
(`worker/`, name `shot-studio-uploads` — D1 + R2 + KV + a `ProjectEvents`
Durable Object for live-sync SSE) for building the Whistlewood episode: script,
shots, audio/video renders, cuts, and library. An [eve](https://eve.dev) chat
agent (`agent/`, port 2000, proxied at `/eve`) drives the pipeline via typed
tools + render skills. See `README.md` for architecture and how to run it.

## Routing & data

URL routing is **React Router v7 in data mode** (`src/router.jsx` → `RootLayout` +
one lazy-loaded route per tab in `src/routes/*.jsx`, each exporting `{ Component,
loader }`). Tabs fetch through their route **`loader`** (stale-while-revalidate via
`src/lib/swr.js`), **not** `useEffect`; components read data with `useLoaderData()`,
and load errors render through the route's `ErrorBoundary` (`RouteError`).

**After any mutation: `invalidateTabCache(key); revalidate()`** — the canonical
pair. `RootLayout` wires that same pair to the three "data changed" signals (the
`/api/data/events` SSE firehose, the Refresh button, and project switch). `reloadKey`
survives **only** as a media cache-bust nonce (`?v=` on `<video>`/`<img>`/`<audio>`),
not for data. Do NOT loaderize the Script (TipTap) or Editor (Remotion) surfaces —
they own their document state. Full route tree, gotchas, and the Worker
`run_worker_first` caveat: **`docs/routing.md`**.

## UI stack

The front-end is built on **Tailwind CSS v4** + **shadcn/ui** (New York style, zinc base,
emerald accent). Key files:

- `src/index.css` — Tailwind entry + the theme tokens (`:root` = light, `.dark` = dark,
  which is the default via `class="dark"` on `<html>`). Colors are OKLCH CSS variables
  mapped through `@theme inline`.
- `src/components/ui/*` — shadcn primitives (`button`, `card`, `dialog`, `tabs`, `badge`,
  `input`, `textarea`, `label`, `checkbox`, `slider`, `tooltip`, `separator`, …). Add more
  with `npx shadcn@latest add <name>`. `Badge` is extended with `success` / `warning` /
  `info` / `muted` variants for status pills.
- `@/` is aliased to `src/` (see `vite.config.js` + `jsconfig.json`), `cn()` lives in
  `src/lib/utils.js`.

**Prefer shadcn components + Tailwind utility classes** over bespoke CSS. Reuse the small
in-file helpers in `App.jsx` (`Empty`, `Eyebrow`, `Chip`, `Panel`, `Spinner`, `ErrorNote`)
for consistency. All modals are shadcn `Dialog` (Esc / overlay-click close for free).

## UI conventions

- **Always use [lucide-react](https://lucide.dev) icons — never emojis or Unicode glyphs**
  (no 🔊 ✕ ✓ ＋ ▾ ★ ↺ ⧉, etc.) in JSX. Import the named icon from `lucide-react` and
  render it as a component, e.g. `import { Volume2 } from "lucide-react"` →
  `<Volume2 size={14} />`. Size icons in px to match the surrounding text, and give
  icon-only buttons an `aria-label`.
- Typographic characters that are punctuation, not icons (e.g. `→`, `·`, `–` inside
  text like "MS-01 → MS-22"), are fine to keep as text.
