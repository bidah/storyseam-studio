# Routing & data loading (React Router v7, data mode)

The SPA uses **React Router v7 in data mode** (`createBrowserRouter` +
`RouterProvider`) — **not** framework mode. It's plain-Vite-built and served as
static assets by the Cloudflare Worker with SPA fallback; framework mode would
replace the Vite build/entry and break Worker asset serving, the Vercel `eve`
build, and the dev proxy for no benefit (there's no SSR host). See
`react-router-migration-plan.md` for the full rationale.

## The studio is a project's url — `/p/:projectId/<view>`

The shell (`RootLayout`: header, tabs, plugins, agent panel) is mounted ONCE, at
`/p/:projectId`. The project is the URL's: the route's loader calls
`setProjectId(params.projectId)` on the fetch shim BEFORE the shell and
`ProjectProvider` render, so a reload, a shared link, or the Film page's
"Continue working on the video" all land on that project's studio whatever the
browser last had open. `lib/home.js` › `studioPath(projectId, view, suffix)`
builds the url; `parseStudioPath` reads it back.

- **Switching project** (the header switcher, or `ProjectProvider` correcting a
  URL naming a project the user can't open) fires `onProjectChange`; RootLayout
  rewrites the address to the new project, same tab (`navigate(..., { replace })`).
- **Bare paths still work.** `/world`, `/editor`, `/settings#…` are matched by a
  catch-all `StudioRedirect` (`components/StudioRedirect.jsx`) that sends them to
  the CURRENT project's `/p/…` url with hash and search kept, or home when no
  project is known. It is a component, not a loader, because a loader's request
  url has no hash and the cross-tab jumps (`/episode#ep-<id>`) would lose theirs.
  Old links, bookmarks and the agent's `navigate` (which speaks bare paths —
  RootLayout prefixes them itself) all go through it.
- **Inside the shell, prefer the project-aware helpers** in `lib/studioNav.js`:
  `useStudioNavigate()` / `useStudioPath()` (a `Link to={studio("/script")}`)
  — a bare path costs a redirect hop and a history entry. The routes' cross-tab
  jumps already use them.
- `useReportNavigation` keeps reporting the BARE view path, so the agent's
  `view_screen` sees the same shape it always did.
- "New project" in the switcher is now "New story": it goes to `/`, where the
  prompt box makes the project around the Film.

## Route tree

`src/router.jsx` — one `RootLayout` with a child route per surface, all under
`/p/:projectId` (shown bare below):

```
/p/<id>           → redirect to /p/<id>/world  (unknown tabs too)
CORE   /world (Bible)  /script  /episode  /editor
PLUGIN /images  /videos            (pre-installed on a new project)
       /agents  /moodboard  /shotlist  /nodes
       /animatic  /radio  /sounds  /musical  /cuts  /library
OTHER  /plugins (the marketplace)  /settings  /members  /accept-invite/:id
       /shots  /multishot  (sample-code surfaces, routed but never in the header)
LEGACY /world/agents → /agents   /world/visual → /images   /world/nodes → /nodes
*                 → redirect to /script
```

**Every route above still exists for every project — the PLUGIN block is gated,
not conditional.** `RootLayout` asks `blockingPlugin(view, enabled)`
(`src/lib/plugins.ts`) and renders `<PluginGate>` instead of the `<Outlet/>`
when the surface belongs to a plugin this project has not installed. Keeping the
routes unconditional is what makes a deep link, a stale bookmark and the agent's
`navigate` all land somewhere sensible: an install prompt, never a 404 or a
silent bounce to /script. See CLAUDE.md § Plugins.

The three `LEGACY` redirects exist because the World tab used to own those
surfaces as sub-routes. They are still in the wild — bookmarks, pasted links,
and a `navigate` command the agent minted before the split.

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

- the `/api/data/events` SSE firehose (agent edits on other tabs) — how that
  stream works end-to-end (emission, the `ProjectEvents` DO, reconnect resync,
  project scoping) is documented in **`docs/live-sync.md`**,
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
