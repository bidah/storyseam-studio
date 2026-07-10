# Routing & data loading (React Router v7, data mode)

The SPA uses **React Router v7 in data mode** (`createBrowserRouter` +
`RouterProvider`) — **not** framework mode. It's plain-Vite-built and served as
static assets by the Cloudflare Worker with SPA fallback; framework mode would
replace the Vite build/entry and break Worker asset serving, the Vercel `eve`
build, and the dev proxy for no benefit (there's no SSR host). See
`react-router-migration-plan.md` for the full rationale.

## Route tree

`src/router.jsx` — one `RootLayout` with a child route per tab:

```
/            → redirect to /script
/script      /shotlist  /shots  /multishot  /episode
/cuts        /editor    /library  /sounds
*            → redirect to /script
```

- **`src/components/RootLayout.jsx`** is the shell: providers
  (`TooltipProvider > AgentProvider > LoginGate > ProjectProvider`), the header
  (project switcher, URL-driven radix `Tabs`, Refresh, theme, account), the
  `<Outlet/>`, `AgentChat`, and `ImageModal`. The active tab comes from
  `useLocation().pathname`; clicking a tab `navigate()`s.
- Each **`src/routes/<tab>.jsx`** exports `{ Component, loader }` — the exact
  shape React Router's `lazy` expects. Routes are code-split via
  `lazy: () => import("@/routes/<tab>")`, so a tab's chunk (and its deps) loads
  on first navigation. Biggest wins: `/editor` (Remotion) and `/script` (TipTap)
  stay out of the main bundle.
- `AgentChat`, `AgentProvider`, `ProjectProvider`, `LoginGate` and the
  `x-project-id` fetch shim (`installProjectScope()` in `main.jsx`, kept before
  `RouterProvider`) are unchanged. `LoginGate` is still the component-level auth
  gate.

## Data loading — loaders + swr

Tabs fetch through their route **`loader`**, not `useEffect`. `src/lib/swr.js`
wraps the loader fetch in stale-while-revalidate over the `tabCache` store:

- `swr(key, fetcher)` — returns the cached payload instantly on a revisit (no
  spinner) and refreshes in the background; awaits the fetch on a cache miss;
  falls back to cache on a transient fetch error, else throws to the route
  `ErrorBoundary` (`RouteError`).
- `useRevalidateOnMount(key)` — after a stale paint, fetches fresh once (skipped
  on a cold load, so no double fetch).
- Components read data with `useLoaderData()`. Load errors render through the
  route's `ErrorBoundary`; **mutation** errors stay local (toast / inline note).

Episode keeps local state slices (many optimistic mutations) but seeds them from
`useLoaderData()` and re-adopts via `applyPayload` whenever the loader data
changes.

## Revalidation — the one rule

> **After any mutation: `invalidateTabCache(key); revalidate()`.**

`invalidateTabCache(key)` drops the cached payload so the loader refetches fresh;
`useRevalidator().revalidate()` re-runs the active route's loader. `RootLayout`
wires the same pair to the three global "data changed" signals:

- the `/api/data/events` SSE firehose (agent edits on other tabs),
- the header **Refresh** button,
- **project switch** (`onProjectChange` → `clearTabCache()` + revalidate).

This replaced the old `reloadKey` / `projectKey` / `liveKey` counters. `reloadKey`
survives **only** as a media cache-bust nonce (`?v=<n>` on `<video>`/`<img>`/
`<audio>` in the shots, multishot, and episode tabs) — it no longer drives data.

## Cross-tab anchor jumps

Complete-cuts markers navigate to `/episode#ep-<id>` or `/sounds#snd-<track>`.
`RootLayout` watches `location.hash` (+ `location.key`, so re-clicking the same
marker re-fires) and retries `getElementById` for a few seconds (the target list
loads async), then `scrollIntoView` + the `nav-flash` class.

## Worker note

Top-level `/script` and `/projects*` are **client routes**, so the Worker's
`assets.run_worker_first` must NOT list them (they fall through to the SPA); the
APIs live under `/api/*`. Don't re-add legacy top-level `/script` or `/projects`
routes to the Worker — a hard reload of the Script tab would get JSON instead of
the app.
