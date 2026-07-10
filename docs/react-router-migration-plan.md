# shot-studio: React Router v7 migration + repo reorganization plan

Two independent workstreams, in one plan:

- **Part A — Vite SPA → React Router v7 (data mode)**: URL routes + loaders
  replace the tab switcher, `tabCache`, and `reloadKey` machinery.
- **Part B — repo & architecture cleanup** (§5): the deployable app lives in
  `shot-studio/` but is buried inside a media-experiments working directory
  with stray tooling files and legacy Express-era data dirs. Centralize it.

Recommended order: **B1 (cheap cleanup) → Part A phases 0–4 → B2 (extraction
decision)**. Don't interleave the big moves.

---

# Part A — Vite SPA → React Router v7 (data mode)

**Goal:** replace the hand-rolled tab switcher in `src/App.jsx` with real URL routes,
and replace per-component `useEffect` fetching + the `tabCache` SWR hack +
`reloadKey` prop-threading with **React Router loaders** and router-driven
revalidation.

**Target: React Router v7 in _data mode_** (`createBrowserRouter` +
`RouterProvider`), **not** framework mode. Reasons:

- The app is built by plain Vite and served as static assets by the Cloudflare
  Worker (`worker/wrangler.jsonc` → `assets.directory: "../dist"`,
  `not_found_handling: "single-page-application"`). Framework mode replaces the
  Vite entry/build (`react-router dev/build`, different `dist` layout) and would
  break the Worker asset serving, the `vercel.json` eve build, and the dev proxy
  in `vite.config.js` for no benefit — there is no SSR host here.
- Data mode gives us everything we actually want: routes, loaders, actions,
  `useFetcher`, `useRevalidator`, lazy route code-splitting.

Install: `npm i react-router` (v7 is the single `react-router` package; do NOT
install `react-router-dom@6`). React 18.3 is already compatible.

---

## 1. Current state (inventory)

### App shell (`src/App.jsx`, ~3,975 lines)

- `App()` holds `const [view, setView] = useState("script")` and renders one of
  8 tab components conditionally inside a radix `<Tabs>` header (`TABS` array at
  ~line 3586). Switching tabs **unmounts** the old tab and mounts the new one.
- Tabs: `script`, `shotlist`, `shots` (hidden), `multishot` (hidden),
  `episode`, `cuts`, `editor`, `library`, `sounds`.
- Provider nesting (App return): `TooltipProvider > AgentProvider(view) >
  LoginGate > ProjectProvider > [header + main + AgentChat] > ImageModal`.
- `App` also fetches `/api/shots` on mount (feeds the header "N shots" count and
  the fallback `shots` tab table).

### Data fetching per tab (all `useEffect` + `tabCache` SWR)

| Tab | Component (in App.jsx unless noted) | Endpoints | tabCache key |
| --- | --- | --- | --- |
| script | `components/ScriptEditor.jsx` | `/api/script` (+ own draft API), refetch on `reloadKey`/`liveKey` | — |
| shotlist | `ShotList` (~1792) | `/api/shotlist` | `shotlist` |
| shots | fallback table in `App` | `/api/shots` | — |
| multishot | `MultiShot` (~434) | `/api/multishot` | `multishot` |
| episode | `Episode` (~1444) | `Promise.all`: `/api/episode`, `/api/library`, `/api/final`, `/api/audio` | `episode` |
| cuts | `CompleteCuts` (~2315) | `/api/episode/cuts` | `cuts` |
| editor | `components/Editor.jsx` | pool + timeline loads (two effects on `reloadKey`) | — |
| library | `Library` (~2484) | `/api/library` | `library` |
| sounds | `SoundStudio` (~3424) | `/api/sounds` + `/api/episode` (bundles) | `sounds` |

### Cross-cutting machinery (all of this gets replaced or simplified)

- **`src/lib/tabCache.js`** — module-global map so a remounting tab paints its
  last payload instantly, then revalidates. Must be cleared on project switch.
- **`reloadKey`** — bumped by (a) the header Refresh button, (b) the
  `/api/data/events` SSE firehose (`useDataLiveEdits`) when the chat agent
  mutates data, (c) project switch. Threaded as a prop into every tab.
- **`projectKey`** — bumped on project switch to remount `<main>` wholesale.
- **`navigateTo({ view, anchor })`** (~line 3755) — cross-tab jump used by the
  Complete-cuts overlay (`navigateTo({ view: "episode", anchor: "ep-12" })`,
  `{ view: "sounds", anchor: "snd-<track>" }`), with a retry loop that waits for
  the async tab load, then scroll+flashes the anchor element.
- **Script live edits** — `/api/script/events` SSE (`useScriptLiveEdits`) bumps
  `liveKey` for ScriptEditor and glows the Script tab trigger
  (`useGlow('[data-script-tab="true"]', …)`).
- **`src/lib/projectFetch.js`** — one-time monkey-patch of `window.fetch` /
  `window.EventSource` (installed in `main.jsx` **before** render) injecting
  `x-project-id`, `x-client-id`, and `credentials: "include"` into every
  same-origin request. **Loaders run through `window.fetch`, so this shim keeps
  working unchanged. Do not remove it.**
- **`components/ProjectProvider.jsx`** — loads `/api/projects`, picks the active
  project (localStorage → server activeId → first), mirrors it into the shim
  (`setProjectId`) and the server (`POST /api/projects/:id/activate`).
- **`components/Login.jsx` (`LoginGate`)** — Better Auth `useSession()`;
  pending → splash, no session → marketing homepage with "Sign in with
  Higgsfield" (OAuth `callbackURL: "/"`), else children.
- **`components/AgentProvider.jsx`** — takes `view` as a prop only to stamp
  `clientContext: { screen: view }` on agent messages.
- **`SoundStudio`** has an inner radix `Tabs` (`music` / `sfx` / `voice`).

### Serving / deploy constraints

- Dev: Vite on :3333 proxies `/api`, media paths, and `/eve` to the deployed
  Worker (`vite.config.js`). Nothing about the proxy changes.
- Prod: the Worker serves `../dist` with SPA fallback. Deep links to client
  routes already fall back to `index.html` — **except** paths listed in
  `assets.run_worker_first`, which include top-level **`/script`**,
  `/projects`, `/projects/*`, `/upload`, `/uploads`, `/healthz`.
- The Worker (`worker/src/index.js`) still has legacy top-level routes
  `GET/PUT /script` (~line 290) and `GET/POST /projects`,
  `PATCH/DELETE /projects/:id` (~line 237) alongside newer `/api/projects/…`
  and `/api/script/…` routes.

**⚠️ Route-name collision:** if the client route for the Script tab is
`/script`, a hard navigation / page reload / shared link to `/script` will be
answered by the Worker's JSON API, not the SPA. Phase 0 resolves this.

---

## 2. Target design

### URL scheme

```
/                     → signed-out: homepage (LoginGate); signed-in: redirect → /script
/script               → Script tab
/shotlist             → Shot list
/shots                → hidden sample tab (kept routable)
/multishot            → hidden sample tab (kept routable)
/episode              → Episode
/cuts                 → Complete cuts
/editor               → Editor (Remotion — lazy loaded)
/library              → Library
/sounds               → Sound studio      (?tab=music|sfx|voice for the inner tabs)
*                     → redirect to /script (or a small 404)
```

Anchors keep working as URL hashes: `/episode#ep-12`, `/sounds#snd-<track>`.

Project stays in the header switcher + `x-project-id` shim for the initial
migration; **Phase 5 (optional)** promotes it into the URL as `/p/:projectId/*`.

### Route tree (data mode)

```jsx
// src/router.jsx
import { createBrowserRouter, redirect } from "react-router";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,        // Tooltip + LoginGate + ProjectProvider + AgentProvider + header shell + <Outlet/> + AgentChat + ImageModal
    id: "root",
    loader: rootLoader,             // (Phase 3+) session/projects preload — optional
    children: [
      { index: true, loader: () => redirect("/script") },
      { path: "script",    lazy: () => import("./routes/script") },
      { path: "shotlist",  lazy: () => import("./routes/shotlist") },
      { path: "shots",     lazy: () => import("./routes/shots") },
      { path: "multishot", lazy: () => import("./routes/multishot") },
      { path: "episode",   lazy: () => import("./routes/episode") },
      { path: "cuts",      lazy: () => import("./routes/cuts") },
      { path: "editor",    lazy: () => import("./routes/editor") },   // keeps Remotion out of the main bundle
      { path: "library",   lazy: () => import("./routes/library") },
      { path: "sounds",    lazy: () => import("./routes/sounds") },
      { path: "*",         loader: () => redirect("/script") },
    ],
  },
]);
```

Each `src/routes/<tab>.jsx` module exports `{ loader, Component }` (the shape
`route.lazy` expects). `main.jsx` renders `<RouterProvider router={router} />`.

**Provider placement:** everything (LoginGate, ProjectProvider, AgentProvider)
moves *inside* the root route element so `useLocation`/`useNavigate` are
available to them. `AgentProvider` drops its `view` prop and derives the screen
name from `useLocation().pathname` internally.

**LoginGate vs loaders:** keep `LoginGate` as the component-level gate exactly
as today (session pending → splash; signed out → homepage). Child loaders may
fire while signed out and get 401s — make the `swr` helper (below) treat a 401
as "no data" rather than throwing to an error boundary, or gate earlier by
checking `authClient.getSession()` in the root loader and rendering the
homepage from root data. Simplest correct v1: LoginGate stays; loaders that 401
return `null` and the component under the gate never renders anyway.

### Loaders + SWR (replaces tabCache-in-components)

Keep instant tab paints. React Router already keeps the **current page visible
while the next route's loader runs**, so spinners on switch disappear for free;
the SWR cache removes the *latency* on revisits too.

```js
// src/lib/swr.js — replaces direct tabCache use in components
import { readTabCache, writeTabCache } from "./tabCache";   // reuse the store

export async function swr(key, fetcher) {
  const cached = readTabCache(key);
  const refresh = fetcher()
    .then((data) => { writeTabCache(key, data); return data; })
    .catch((e) => { if (cached === undefined) throw e; return cached; });
  return cached !== undefined ? cached : refresh;   // stale now; fresh lands via revalidation
}
```

- On a cache **hit**, the loader returns instantly with stale data. Freshness is
  guaranteed by the existing SSE firehose → `revalidate()` wiring (below) plus
  an unconditional `revalidator.revalidate()` in a small
  `useRevalidateOnMount()` hook (or simply always revalidate after paint in the
  route component). Either way: paint stale → background loader run → UI updates.
- On a **miss**, the loader awaits the fetch; RR holds the previous screen (use
  `useNavigation()` to show the subtle pending cue in the header if desired).
- `clearTabCache()` still runs on project switch (see below).

Example route module:

```jsx
// src/routes/episode.jsx
import { swr } from "@/lib/swr";

export async function loader() {
  return swr("episode", async () => {
    const [episode, library, final, audio] = await Promise.all([
      fetch("/api/episode").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()),
      fetch("/api/final").then((r) => r.json()),
      fetch("/api/audio").then((r) => r.json()),
    ]);
    return { episode, library, final, audio };
  });
}

export function Component() {
  const data = useLoaderData();
  // …Episode UI, mutations call fetch(...) then revalidator.revalidate()
}
```

### Revalidation replaces `reloadKey` / `projectKey` / `liveKey`

All three counters collapse into router revalidation, wired **once** in
`RootLayout`:

```jsx
function RootLayout() {
  const revalidator = useRevalidator();

  // Agent live-sync firehose (was useDataLiveEdits + reloadKey threading)
  useEffect(() => {
    const es = new EventSource("/api/data/events");
    es.onmessage = (e) => {
      try { if (JSON.parse(e.data).clientId !== CLIENT_ID) revalidator.revalidate(); }
      catch { /* heartbeats */ }
    };
    return () => es.close();
  }, []);

  // Project switch (was clearTabCache + reloadKey + projectKey remount)
  useEffect(() => onProjectChange(() => {
    clearTabCache();
    revalidator.revalidate();
  }), []);

  // Header Refresh button → revalidator.revalidate()  (delete `load()` / reloadKey)
}
```

- `revalidate()` re-runs the **active** route's loader; the loader's `swr` call
  must fetch fresh when revalidating, not return stale. Amend the helper: pass
  `{ force }` or check `revalidator.state`; simplest is a module flag set by the
  Refresh/SSE handlers (`invalidate(key)` deletes the cache entry, then
  `revalidate()`), i.e.:
  `invalidateTabCache(); revalidator.revalidate();` — **cache-delete + revalidate
  is the canonical pair**; use it everywhere a `reloadKey` bump exists today.
- Project switch: keep the `<main key={projectKey}>` remount trick during
  Phases 1–4 if any component holds project-scoped local state; it can be a
  simple `useState` counter in RootLayout. Phase 5 removes it (URL param change
  remounts naturally).
- **Script tab specifics:** `useScriptLiveEdits` (the `/api/script/events` SSE)
  stays, but moves the glow logic to reading `useLocation().pathname ===
  "/script"` instead of `viewRef`. `ScriptEditor`'s `liveKey` prop can stay
  as-is in Phase 2 (RootLayout passes the counter via context or the route
  re-mounts on revalidation) — do **not** try to make the TipTap editor
  loader-driven; it manages its own document lifecycle. Script route's loader
  can simply return null initially; migrate ScriptEditor's internal fetch later
  or never (it is a live-editing surface, not a read view — loaders fit it
  poorly).
- **Editor tab:** same caveat — the Remotion timeline editor mutates local
  state heavily; give it a loader for the initial pool/timeline payload only if
  cheap, else leave its internal effects and just replace `reloadKey` with a
  revalidation-context subscription. Don't force it.

### Cross-tab anchor jumps (`navigateTo`)

Replace the `navTarget` state machine with hash navigation:

```js
const navigate = useNavigate();
// was: navigateTo({ view: "episode", anchor: "ep-12" })
navigate(`/episode#ep-${seg.id}`);
```

Add one hook in RootLayout that watches `location.hash`, retries
`document.getElementById(hash)` for a few seconds (same 40×100 ms loop — the
target list still loads async), then `scrollIntoView` + the existing
`nav-flash` class. Re-navigation to the same hash: use
`navigate(to, { state: { nonce: Date.now() } })` or clear the hash after
flashing so the effect re-fires. Delete `navigateTo`, `navTarget`, `navNonce`
from App.

Add `<ScrollRestoration />` (from `react-router`) in RootLayout so normal tab
switches restore scroll position — but make it ignore hash navigations
(`getKey` or default behavior handles this; verify).

### Sound studio inner tabs

`?tab=sfx` via `useSearchParams` so a link can land on a specific sub-tab.
Keep radix `Tabs` as the control; `value` comes from the search param
(default `music`), `onValueChange` → `setSearchParams({ tab }, { replace: true })`.
The `snd-<track>` anchor jump from Complete cuts should navigate to
`/sounds?tab=<kind-of-track>#snd-<track>` — the cut overlay knows the cue's
track kind (music today), default `music` is fine for v1.

---

## 3. Phases

Each phase leaves the app shippable. Commit per phase.

### Phase 0 — pre-flight: clear the URL namespace (Worker)

1. In `worker/src/index.js`: find callers of legacy top-level `GET/PUT /script`
   and `GET/POST/PATCH/DELETE /projects…` (grep the repo: `agent/`, `scripts/`,
   `src/` for fetches to `/script` and `/projects` **without** the `/api`
   prefix — note `ProjectProvider` already uses `/api/projects`). Migrate any
   remaining callers to the `/api/script` / `/api/projects` equivalents (add
   them in the Worker if missing — likely they already exist).
2. Remove `"/script"`, `"/projects"`, `"/projects/*"` (and `"/upload"`,
   `"/uploads"` if unused by external tooling) from `assets.run_worker_first`
   in `worker/wrangler.jsonc`, and delete/alias the legacy Worker routes.
   If an external caller (eve agent skills, shell scripts) can't move yet, keep
   the Worker route but **rename the client route instead** (e.g. `/write`),
   — do not ship a collision.
3. Deploy the Worker; verify `GET https://…workers.dev/script` now returns the
   SPA `index.html` (SPA fallback) and `/api/script` still serves the API.

### Phase 1 — mechanical split of `App.jsx` (no router yet)

Pure code motion so Phase 2's diff is reviewable:

1. Create `src/routes/` and move each tab component (+ its private helpers)
   out of `App.jsx`: `episode.jsx`, `cuts.jsx`, `library.jsx`, `shotlist.jsx`,
   `multishot.jsx`, `shots.jsx` (the fallback table), `sounds.jsx`. `script`
   and `editor` already live in `components/` — add thin
   `src/routes/script.jsx` / `editor.jsx` wrappers later (Phase 2).
2. Move shared in-file helpers (`Empty`, `Eyebrow`, `Chip`, `Panel`, `Spinner`,
   `ErrorNote`, `MediaTakes`, `EditableCell`, `soundApi`, `trackKind`, modal
   pieces, etc.) into `src/components/shared.jsx` (or a few sensible files).
   Keep exports/imports 1:1; **zero behavior change**.
3. Verify: app runs identically (`npm run stack`), all tabs work.

### Phase 2 — introduce the router (routes only, no loaders)

1. `npm i react-router`.
2. Add `src/router.jsx` with the route tree above; route modules just
   `export const Component = <existing tab component>` (still doing their own
   effect-fetching with `reloadKey` supplied via a small
   `RevalidationContext { reloadKey }` from RootLayout — temporary shim).
3. Build `RootLayout` from App's current shell: providers, header, `TabsList`
   → keep radix Tabs for styling but drive it from the URL:
   `value={pathname.slice(1) || "script"}`, `onValueChange={(v) => navigate("/" + v)}`
   (or swap `TabsTrigger` for styled `NavLink`s — either is fine; keeping radix
   Tabs is the smaller diff and preserves the `data-script-tab` glow hook).
4. `main.jsx`: render `<RouterProvider router={router} />`. Keep
   `installProjectScope()` before render. Keep `StrictMode`.
5. Replace `navigateTo` with hash navigation + the RootLayout anchor hook.
   Update the 4 call sites in Complete cuts (`~lines 2083/2096/2173/2191`).
6. `AgentProvider`: drop the `view` prop, use `useLocation` internally
   (`screen = pathname.slice(1)`).
7. Move App's `/api/shots` header-count fetch into RootLayout (unchanged), or
   drop the count from the header. The Refresh button keeps bumping the
   temporary `reloadKey` context this phase.
8. Verify: every tab reachable by URL, browser back/forward works, deep-link
   reload works in dev (`vite` serves SPA fallback automatically) **and** in a
   Worker deploy, OAuth round-trip still lands on `/` → redirects to `/script`.

### Phase 3 — loaders + revalidation

1. Add `src/lib/swr.js` (+ `invalidateTabCache`) as specced. Delete per-key
   direct `readTabCache/writeTabCache` use from components.
2. Per route (do them one at a time, in this order — simplest first):
   `library` → `cuts` → `shotlist` → `multishot` → `shots` → `sounds` →
   `episode`. For each: add `loader` to the route module, replace the
   load-effect + `loading/error/data` state with `useLoaderData()`, keep
   mutation handlers but end them with `invalidate(key) + revalidate()` instead
   of manual `load()`.
   - Route-level `errorElement` (one shared `RouteError` styled like
     `ErrorNote`) replaces per-tab error state for **load** errors; mutation
     errors stay local state/toasts as today.
3. Wire RootLayout: SSE firehose → invalidate+revalidate; Refresh button →
   invalidate+revalidate; `onProjectChange` → `clearTabCache()` + revalidate.
   Delete the `RevalidationContext` shim, `reloadKey`, `useDataLiveEdits`'s
   counter indirection.
4. Script + Editor: leave internal fetching (see rationale in §2); just
   subscribe them to the same revalidation signal where they used `reloadKey`
   (`useRevalidator().state` transitions or keep a tiny context bump).
5. Pending UX: `useNavigation().state === "loading"` → reuse the header
   spinner affordance (optional; with SWR hits it will almost never show).
6. Verify: tab switch paints instantly from cache then updates; agent edits
   from chat reflect on the open tab without Refresh; project switch shows no
   stale flash; Refresh button refetches.

### Phase 4 — code-splitting + cleanup

1. Convert route modules to `route.lazy()` (as in the tree above). Biggest win:
   `/editor` (Remotion player/bundler deps) leaves the main chunk. Check
   `vite build` output; expect main bundle to shrink substantially.
2. Delete dead code: `navTarget` machinery, `projectKey` (if provably safe),
   `TABS` `hidden` handling if you'd rather just not render those NavLinks,
   `useGlow` selector hack if you switched to NavLink (can attach a real ref).
3. Update `shot-studio/CLAUDE.md` + `README.md`: routing section (data mode,
   route modules, swr helper, revalidation rules — "after any mutation:
   `invalidate(key); revalidate()`").

### Phase 5 (optional, recommended later) — project in the URL

`/p/:projectId/script` etc. Root layout route gains a `:projectId` segment
whose loader validates the id against `/api/projects` and calls
`setProjectId(param)` so the fetch shim follows the URL (URL becomes the source
of truth; localStorage just seeds the redirect from `/`). ProjectSwitcher →
`navigate` to the same tab under the new project. Kill `projectKey` remount and
`onProjectChange` wiring (param change → loaders re-run naturally). This makes
project links shareable and is where loaders really pay off — but it touches
the eve-agent's `x-project-id` assumptions, so scope it separately.

### Phase 6 (optional) — mutations as actions/fetchers

Incrementally move POSTs (`/api/episode/select`, `/api/library/toggle`, sound
create, …) to route `action`s / `useFetcher` for free pending states and
automatic revalidation. Not required for the payoff; do it opportunistically
when touching a tab.

---

## 4. Gotchas checklist (read before coding)

- [ ] **`/script` Worker collision** — Phase 0 is mandatory before Phase 2
      ships; otherwise reloading the Script tab in prod returns JSON.
- [ ] **Keep `installProjectScope()`** in `main.jsx` before `RouterProvider`;
      loaders rely on the patched `window.fetch` for `x-project-id` +
      `credentials`.
- [ ] **Loaders run before `LoginGate` renders** — a signed-out deep link fires
      loaders that 401. Make `swr`/loaders 401-tolerant (return null) or check
      the session in the root loader.
- [ ] **StrictMode double-invokes effects** in dev (already true today) — SSE
      subscriptions in RootLayout must clean up properly (they do; keep it).
- [ ] **`revalidate()` must not return stale cache** — always pair
      `invalidate(key)` with `revalidate()`; a bare revalidate after SSE would
      re-serve the cache. (Alternative: have `swr` always kick a background
      refresh and re-write the cache; then a second revalidate isn't needed —
      pick ONE strategy and document it in the helper.)
- [ ] **Radix Tabs as nav**: `TabsContent` is no longer used — the `<Outlet/>`
      renders content. Only `TabsList/TabsTrigger` remain (styling shell). Or
      restyle `NavLink`s with the same classes.
- [ ] **Hash anchor retry loop** still needed (target lists load async).
      Re-trigger on same-hash navigation via location `key`, not just hash.
- [ ] **`Episode (48)` label + header shot count** come from the root
      `/api/shots` fetch — decide: keep in RootLayout, or move into a root
      loader.
- [ ] **Don't loaderize TipTap (Script) or the Remotion Editor** — live-editing
      surfaces own their document state; loaders would fight them.
- [ ] **OAuth**: Better Auth `callbackURL: "/"` → `/` redirects to `/script`;
      confirm the Higgsfield OAuth round-trip end-to-end after Phase 2 (the
      callback path `/api/auth/*` is under `run_worker_first` — untouched).
- [ ] **`vercel.json` (`framework: "eve"`) and the Worker deploy scripts are
      untouched** — the build stays `vite build`; if anything asks to change
      `buildCommand` or dist layout, that's framework-mode creep — stop.
- [ ] Test a **production Worker deploy** (`npm run worker:deploy`) at Phase 2
      and Phase 3, not just dev: SPA fallback, `run_worker_first`, and SSE
      behave differently behind the Vite proxy vs the Worker.

## 5. Part B — repo & architecture reorganization

### Current reality (verified 2026-07-10)

The git repo root (`testing-rofi-spaceship/`) is a media working directory that
accreted a production app in one subfolder:

- **The app is 100% inside `shot-studio/`** — Vite SPA (`src/`), Cloudflare
  Worker (`worker/`), eve agent (`agent/`), Remotion render fn (`render-fn/`),
  plus its own `package.json`, `vercel.json`, `components.json`.
- **Root `package.json` is a stray**: `{ "devDependencies": { "shadcn": "^4.13.0" } }`
  — leftover from running `npx shadcn` at the wrong cwd once. The real shadcn
  config (`components.json`) is in `shot-studio/`. Root `node_modules/` +
  `package-lock.json` exist only to serve it.
- **`script-studio/`, `sound-studio/`, `shot-by-shot/` are NOT apps** — they
  were the old Express backend's on-disk data stores (`script.json`,
  `sounds.json`, media folders). That backend was retired; the data was
  migrated to R2/D1 (`worker/migrate-to-r2.sh`). The only remaining references
  in live code are **comments** in `worker/src/lib/media.js`,
  `worker/src/lib/pack.js`, `worker/src/routes/library.js` describing the old
  layout; the frontend uses URL prefixes (`/sound-media`, `/refs`, …) served
  from R2, not these folders.
- Everything else at root (`episode-multishot/`, `final_selection/`,
  `locations/`, `mote/`, `draft-2/`, `possible-characters/`, loose `.txt`/.jpg
  files, …) is generation working material, largely untracked or purged from
  history already (see commit `1fef3ae`).
- Stray file: `shot-studio/worker/does-not-exist` (untracked, empty-looking) —
  delete it.

### B1 — cheap cleanup (do first, ~30 min)

1. Delete root `package.json`, `package-lock.json`, `node_modules/`
   (re-run any future `npx shadcn add …` from inside `shot-studio/`, which is
   where `components.json` lives).
2. Delete `shot-studio/worker/does-not-exist`.
3. **Verify then archive the legacy data dirs**: confirm nothing reads them —
   `grep -rn "script-studio\|sound-studio/\|shot-by-shot" shot-studio --include='*.js' --include='*.jsx' -l`
   should return only the comment hits listed above, and
   `shot-studio/agent/instructions.md` (update its wording). Then move
   `script-studio/`, `sound-studio/`, `shot-by-shot/` into `_archive/`
   (or delete if the R2 migration is trusted — they're small except
   `shot-by-shot` at ~44 MB). Do NOT delete without the grep + a quick smoke
   test of the deployed app (media plays, refs resolve).
4. Add a root `README.md` (3 lines): "the app is `shot-studio/`; everything
   else is generation working material."

### B2 — centralize the app (decide after Part A)

Two options; **recommend option 1**:

1. **Extract `shot-studio/` to its own repo** (e.g. `shot-studio`), keeping
   this repo as the media scratchpad. The app is deployable product code with
   3 deploy targets (Worker, Vercel eve, Remotion); it deserves its own
   history, CI, and issues, and its git history is already polluted by media
   purges. Use `git filter-repo --subdirectory-filter shot-studio` (or a fresh
   repo + copy if history doesn't matter). Update: Vercel project root
   directory setting, any absolute paths in `worker/*.sh` scripts, memory/docs
   that say the app lives here.
2. **Or invert in place**: make `shot-studio/` the repo root content and move
   media into `media-work/`. More churn for less benefit; only pick this if
   the media dirs must stay co-versioned with the app.

Inside the app, optionally formalize the multi-runtime layout with npm
workspaces (`web/` = Vite SPA, `worker/`, `agent/`, `render-fn/` — today the
SPA and agent share one root `package.json`, which is why `express`,
`@daytona/sdk`, and `@remotion/renderer` sit next to `react`). This is a
nice-to-have; do it only after Part A lands, as a standalone change, since it
moves `src/` and touches every import path in tooling configs.

## 6. Verification script (run after each Part A phase)

1. `npm run stack`; sign in; visit each of the 7 visible tabs by clicking AND
   by URL (`localhost:3333/episode`, `/cuts#ep-…`, `/sounds?tab=sfx`).
2. Reload on a deep link — no white screen, no JSON.
3. From Complete cuts, click a segment marker → jumps to `/episode#ep-N` and
   flashes the card; click a music cue → `/sounds` anchor.
4. Ask the chat agent to edit the script from the `/episode` tab → Script tab
   glows; open it → fresh content. Ask the agent to mutate episode data →
   open tab updates without Refresh.
5. Switch projects in the header → no stale flash of the other project's data.
6. Browser back/forward walks the tab history correctly.
7. `npm run build && npm run worker:deploy` → repeat 2–5 against the deployed
   Worker URL.
