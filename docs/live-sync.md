# Live-sync: agent → UI updates over SSE

**The canonical reference for how a data change made anywhere (chat agent, another
tab, another device) shows up in every open tab without a manual Refresh** — and
for the failure modes that used to break it. Companion to `docs/routing.md`
(which owns the loader/cache conventions this system drives).

## Problem statement

The eve chat agent (deployed on **Vercel**, `agent/`) mutates project data by
calling the Cloudflare Worker's public `/api/*` endpoints (`agent/lib/api.ts`).
The browser talks to the same Worker (**Cloudflare**, `worker/`), which serves
the SPA, the data API, and the live-sync SSE streams. When the agent changed
something — a Sound Studio track, a character, a shot prompt — open tabs often
did **not** update; users had to press the header Refresh button.

The investigation (2026-07) found the pipeline design was sound but the
transport had nine independent holes, each sufficient to produce "UI doesn't
update". All are fixed; they are documented below so they don't regress. Holes
1–7 were the first pass; holes 8–9 (zombie-OPEN streams, silent broadcast
drops) were the two silent-by-construction modes closed in the follow-up
hardening pass.

## Architecture

```
agent (Vercel) ──POST /api/sounds──▶ Worker (Cloudflare)
browser tab A ──POST /api/... ─────▶   │ writes R2/D1
                                       │ post-mutation middleware
                                       ▼
                              broadcast(env, projectId, "data", …)
                                       │  (waitUntil, retried)
                                       ▼
                        ProjectEvents DO — idFromName(normalizeProjectId(pid))
                          channels: "data" | "script" | "timeline"
                                       │  data: {…}\n\n frames
             ┌─────────────────────────┴───────────────────────┐
             ▼                                                  ▼
   tab A  EventSource /api/data/events              tab B  EventSource …
   (own write echo-suppressed via clientId)         invalidateTabCache()
                                                    revalidator.revalidate()
```

### Emitter (Worker)

- **Generic firehose middleware** — `worker/src/index.js` (`app.use` after the
  project-resolution middleware): after **every successful (`status < 400`)
  non-GET `/api/*` request** (excluding `/api/auth/*`, `*/events`,
  `/api/script*`, `/api/timeline*`) it broadcasts on the project's `"data"`
  channel. New endpoints get live-sync for free — no per-endpoint wiring.
- **Payload**: `{ path, resource, clientId, at }`. `resource` is the coarse
  key from the path (`/api/sounds/…` → `"sounds"`) reserved for future targeted
  invalidation; the client currently invalidates everything regardless.
  `clientId` echoes the browser's `x-client-id` header (null for the agent).
- **Dedicated channels**: script (`worker/src/routes/script.js`,
  `broadcastScript`) and timeline (`worker/src/routes/timeline.js`) emit their
  own targeted payloads on the `"script"` / `"timeline"` channels and are
  excluded from the firehose.
- **`broadcast()`** (`worker/src/lib/broadcast.js`): fans out to the
  `ProjectEvents` DO under `ctx.waitUntil` — off the request's critical path
  (a slow DO must never stall the write; seen in the wild as
  `UND_ERR_HEADERS_TIMEOUT` on the agent's `PUT /api/script`). 10s timeout +
  one retry (a cold DO start can exceed a short window). **The DO name is
  `normalizeProjectId(projectId)`** — see "Design decisions".
- **Not covered by design**: `/upload`, `/ingest*` (Daytona render sandboxes)
  and other non-`/api/*` writes don't emit; the `/api/*` call that finishes
  those flows (e.g. `POST /api/sounds/:id/version/:v/attach`) does.

### The `ProjectEvents` Durable Object (`worker/src/sse-do.js`)

One instance per project. `GET /subscribe?channel=…` opens an SSE client
(`TransformStream` writer held in memory); `POST /broadcast?channel=…` stamps a
monotonic per-channel `seq` into the JSON body, frames it as `data: <json>\n\n`,
and writes to every subscriber. A shared 25s timer writes **named**
`event: ping\ndata: {"seq":<n>}\n\n` heartbeat frames (and one is written
immediately on subscribe). Named events never fire `EventSource.onmessage`, so
they can't be mistaken for edits; clients use them for a liveness **watchdog**
and to detect a silently-missed broadcast (a ping `seq` ahead of the last data
frame a client saw). The per-channel `seq` counter is in-memory only. No
hibernation, no storage, **no replay buffer**: if the instance is evicted the
sockets drop, the seq resets, and clients reconnect — catch-up is the client's
job (below), and every reconnect forces a resync so a seq reset is harmless.

### Subscriber (browser)

- **`src/lib/useProjectEvents.js`** — the one hook for all three channels.
  `RootLayout` uses it for `/api/data/events` and `/api/script/events`.
  Returns `{ edits, resyncs }`:
  - `edits` — a change made elsewhere (own writes echo-suppressed by comparing
    `payload.clientId` to this tab's `CLIENT_ID`).
  - `resyncs` — the stream reconnected after an error, OR the seq gap check
    fired (a data frame or ping revealed a missed broadcast without a
    disconnect); events may have been missed, so callers must refetch on it too
    (cosmetic reactions like the Script tab glow ignore it).
  - The hook also listens for the named `ping` event to feed a **watchdog**
    (`WATCHDOG_MS = 60s`, ~2.4× the 25s heartbeat): if no frame — edit or ping —
    arrives within that window the stream is presumed zombie-OPEN and is torn
    down + rebuilt (which bumps `resyncs`). `onerror` never fires on a dead TCP
    path, so the watchdog is the only thing that catches it while foregrounded.
- Reaction (`src/components/RootLayout.jsx`): on `edits + resyncs` →
  `setReloadKey` (media nonce), `invalidateTabCache()` (whole store),
  `revalidator.revalidate()` (active route's loader reruns), plus `load()`
  for the header shot count. Tabs you're not looking at refetch lazily on next
  visit because their swr cache entry is gone.
- **Project scoping**: `EventSource` can't set headers, so the patched
  constructor (`src/lib/projectFetch.js`) appends `?projectId=<current>` at
  construct time. The hook keeps `projectId` in its effect deps (via
  `onProjectChange`) so switching projects tears the stream down and
  reconnects with the new id.

### Topology per environment

- **Prod**: the Worker serves SPA + API + SSE same-origin (`run_worker_first`
  includes `/api/*` in `worker/wrangler.jsonc`); the agent on Vercel calls the
  `workers.dev` origin directly (`SHOT_STUDIO_API`). No proxies in the path.
- **Local dev**: Vite (:3333) proxies to the Worker. **All three** SSE routes
  need the unbuffered `sse()` proxy entry in `vite.config.js`, listed before
  the generic `"/api"` entry (`accept-encoding: identity`, no buffering).
- The agent never emits events itself — it has no notify path; live-sync is
  entirely a Worker-side effect of its `/api/*` calls. Since it sends no
  `x-client-id`, its writes always count as "foreign" and reach every tab.

## The seven failure modes (and their fixes)

| # | Failure | Fix |
|---|---------|-----|
| 1 | **Dev proxy buffered the data firehose.** `/api/script/events` and `/api/timeline/events` had unbuffered `sse()` proxy entries; `/api/data/events` fell through the generic buffering `api()` proxy — data events never arrived in local dev while script live-sync worked. This was the daily "Sound Studio doesn't update" symptom. | `"/api/data/events": sse(WORKER)` in `vite.config.js`. |
| 2 | **Subscription never followed the project.** The old hooks created their `EventSource` once (`[]` deps) with `?projectId=` baked in at construct time; project switch (or mounting before an id existed) left the tab subscribed to the wrong project's DO forever. | `useProjectEvents` keeps `projectId` in its effect deps and reconnects on `onProjectChange`. |
| 3 | **Broadcast silently no-oped on null projectId.** The Worker resolves projectId header ‖ query ‖ active-project lookup, which can be `null` (agent HITL resume with lost turn context, no session cookie). The *write* still landed via the `p_default` fallback in `docKey`, but `broadcast()` returned early — data changed, no event, manual Refresh showed it. | `normalizeProjectId()` (exported from `worker/src/lib/docs.js`) is now the single key for storage, `broadcast()`, and the `eventsRoute` subscribe side. Write and event can no longer diverge. |
| 4 | **No resync after reconnect.** No `onerror`/`onopen` handling; the DO keeps no replay; events during a disconnect (laptop sleep, DO eviction, worker deploy) were lost forever. | `useProjectEvents` bumps `resyncs` on reconnect-after-error and on visibility-change recovery of a zombie CLOSED stream; RootLayout refetches on it. |
| 5 | **Fire-and-forget broadcast with a 2s abort** — a cold DO start blew the window and dropped the event silently. | 10s timeout + one retry, still under `waitUntil` (off the critical path). |
| 6 | **Shots tab wasn't loaderized** — it read RootLayout's local `/api/shots` state, which the SSE effect never refreshed. | `src/routes/shots.jsx` has a `loader()` on swr key `"shots"`; RootLayout keeps `load()` only for the header count and calls it from the SSE + project-switch effects. |
| 7 | **Editor never subscribes to `/api/timeline/events`.** The Remotion editor owns its document state (see `docs/routing.md`) and has no live stream. | **Known gap, out of scope** — documented here so it's a decision, not a surprise. |
| 8 | **Zombie-OPEN EventSource.** The 25s heartbeats were SSE *comments* (`: ping`), invisible to the `EventSource` API. A dead TCP path that never surfaces an `onerror` left `readyState === OPEN` forever; the client believed it was connected and the fatal-CLOSED / visibilitychange recovery paths never fired (observed: `/api/data/events` healthy while `/api/script/events` silently dead). | Heartbeats are now named `event: ping` **frames**. Both clients (`useProjectEvents.js`, mobile `sse.ts`) run a `WATCHDOG_MS = 60s` liveness timer fed by every frame; on a trip they tear down + rebuild, forcing a resync. |
| 9 | **Silent broadcast drop.** `broadcast.js`'s `fanOut()` retried twice and swallowed every error with an empty `catch {}` — a double failure meant the event was gone with nothing in `wrangler tail`. | `fanOut()` now `console.error`s each failed attempt (HTTP status or thrown message) and a final `DROPPED` line, so every lost fan-out is attributable from logs. |

## Design decisions

- **Revalidate-on-reconnect instead of a replay ring / `Last-Event-ID`.** The
  payloads carry no data — the client's reaction to *any* event is
  "invalidate + refetch", so replaying N missed events is exactly equivalent to
  one revalidate. Monotonic ids, a storage-backed ring, and `Last-Event-ID`
  plumbing would buy nothing today. Revisit only if payloads ever become
  data-bearing (targeted patches).
- **Heartbeats are named `event: ping` frames (was: SSE comments).** Originally
  they were `: ping` comments — invisible to the `EventSource` API — on the
  theory that dead TCP always surfaces through `onerror`/auto-reconnect and
  zombie streams are caught on `visibilitychange`. That theory had a hole
  (#8): a dead-but-never-errored path stays `readyState === OPEN` forever while
  foregrounded. Pings are now real frames carrying a per-channel `seq`, feeding
  a client-side liveness watchdog and seq-gap detection. They stay **named** so
  they never fire `onmessage` — broadcast frames remain unnamed, so the edit
  path and echo suppression are untouched. The opening `: connected` comment is
  kept (harmless, matches the Express legacy).
- **Self-healing via `seq`, not `Last-Event-ID`.** Each broadcast carries a
  monotonic per-channel counter; pings carry the current value. A client that
  sees a data-frame gap (`seq !== last + 1`) or a ping `seq` ahead of its last
  data frame knows it missed a broadcast and resyncs — converging within one
  heartbeat (~25s) of a silent loss, *without* a disconnect. In-memory only: a
  DO eviction resets `seq`, but eviction also drops every socket, and reconnect
  already forces a resync, so the reset is absorbed (clients reset `lastSeq` to
  `null` on every connect). **Limit:** a broadcast that never reached the DO at
  all (hole #9 double-failure) never increments `seq`, so `seq` can't detect it —
  hole #9's logging is the mitigation there.
- **`normalizeProjectId` is the invariant.** Storage (`docKey`, `mediaKey`,
  library asset keys), the broadcast DO name, and the subscribe DO name all
  resolve a missing/invalid project id to the same `p_default` key. Any new
  code that names a per-project resource must use it.
- **Invalidate-everything is deliberate (for now).** One firehose event drops
  the whole tab cache; only the active route refetches immediately. Payloads
  already carry `resource` so a future change can map it to swr keys and
  invalidate selectively — do that only if refetch cost ever becomes a problem.
- **The agent needs no live-sync code.** Reliability lives entirely in the
  Worker + client. The only agent-side guard is a `console.warn` in
  `agent/lib/api.ts` when a mutation goes out without a project id.

## Verification playbook

No automated test infra covers this path — verify end-to-end after touching any
of the pieces:

1. **Dev proxy**: `npm run dev`; ask the agent to edit a sound → Sound Studio
   updates live; DevTools Network shows `/api/data/events` as a pending stream
   receiving frames on each mutation.
2. **Echo suppression**: two tabs on the same project; mutate in tab A → tab B
   refetches, tab A does not double-refresh.
3. **Project switch**: switch in the header → Network shows the old
   EventSource closed and a new one carrying the new `?projectId=`; an agent
   edit in the new project arrives; a tab left on the old project doesn't get it.
4. **Reconnect resync**: DevTools → Offline; mutate from another tab; back
   Online → the missed change appears on reconnect (and no false Script glow).
5. **Null-project broadcast**: `curl -X POST` a mutation to the Worker with no
   `x-project-id`/cookie → `wrangler tail` shows the broadcast (to `p_default`),
   not a skip; a subscriber without a projectId receives it.
6. **HITL**: run an agent flow that pauses for input; post-resume writes hit
   the right project and the event arrives (watch for the api.ts warning in
   Vercel logs if not).
7. **Shots + header count**: an agent shot edit updates the shots table and the
   "N shots" header without Refresh.
8. **Ping visibility**: `curl -N '<worker>/api/data/events?projectId=<pid>'` →
   an `event: ping` frame immediately on connect and again within ~25s. Repeat
   through the dev proxy (`:3333`) to confirm unbuffered pass-through.
9. **Watchdog**: temporarily raise `HEARTBEAT_MS` in `sse-do.js` to ~10 min,
   open a tab → within ~60s the console shows `[live-sync] watchdog reconnect`
   (web) / `watchdog: no frames for 60s` (mobile) and a refetch fires. Restore
   the constant.
10. **No ping-as-edit regression**: leave tabs idle on Script + Sounds for 2 min
    → no Script glow, no refetch storm, no mobile `invalidateAll` spam.
11. **Broadcast logging**: point `PROJECT_EVENTS` at a bogus binding (or stop the
    DO) and make a write → `wrangler tail` shows the per-attempt errors and the
    `DROPPED` line.
12. **Seq gap**: two tabs; throttle tab B offline just long enough to miss one
    edit from tab A but not error the stream → tab B refetches on the next ping.
13. **Prod**: `npm run worker:deploy`, then repeat 2–4 against the deployed origin.

## Future work

- Targeted invalidation: map `payload.resource` → swr cache key and refetch
  only the affected tab (the field is already emitted).
- Editor: subscribe to `/api/timeline/events` (or fold it into the firehose)
  once the Remotion surface has a safe merge story for external edits.
- Replay/`Last-Event-ID` only if payloads become data-bearing.
