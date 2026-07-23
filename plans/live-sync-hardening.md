# Live-sync hardening: SSE + ProjectEvents DO

**Goal:** close the two remaining silent failure modes in the agent→UI live-sync
pipeline so an agent write (e.g. a script draft-diff proposal) is never invisible
until a manual Refresh, and so the *next* incident is attributable from logs.

**Context:** `docs/live-sync.md` documents the pipeline and the seven holes fixed
in 2026-07. Two survived that pass, both silent by construction:

- **Hole A — zombie-OPEN EventSource.** The DO's 25s heartbeats are SSE
  *comments* (`: ping`), invisible to the `EventSource` API. A dead TCP path that
  never surfaces an error leaves `readyState === OPEN` forever; the client
  believes it's connected and the recovery paths in `useProjectEvents`
  (fatal-CLOSED retry, visibilitychange) never fire. Matches the observed
  incident: `/api/data/events` healthy (world update arrived) while
  `/api/script/events` was silently dead (proposal needed Refresh).
- **Hole B — silent broadcast drop.** `worker/src/lib/broadcast.js` fans out
  under `waitUntil`, tries twice, and swallows every error with no logging. A
  double failure = event gone, nothing in `wrangler tail`.

**Non-goals:** switching to WebSockets (transport doesn't fix either hole; loses
EventSource auto-reconnect, Vite proxy simplicity, web/mobile parity — revisit
only for presence/collab features or DO-duration cost), replay buffers /
`Last-Event-ID` (payloads are data-free; revalidate-on-resync is equivalent).

---

## Phase 1 — Observability: log broadcast failures

**File:** `worker/src/lib/broadcast.js`

In `fanOut()`, replace the silent `catch {}` and the silent non-ok fall-through:

```js
async function fanOut(env, projectId, channel, payload) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const stub = env.PROJECT_EVENTS.get(env.PROJECT_EVENTS.idFromName(projectId));
      const res = await stub.fetch(`https://do/broadcast?channel=${channel}`, { ... });
      if (res.ok) return;
      console.error(
        `[live-sync] broadcast ${channel}@${projectId} attempt ${attempt + 1} → HTTP ${res.status}`,
      );
    } catch (err) {
      console.error(
        `[live-sync] broadcast ${channel}@${projectId} attempt ${attempt + 1} threw:`,
        err?.message || err,
      );
    }
  }
  console.error(`[live-sync] broadcast ${channel}@${projectId} DROPPED after ${RETRIES + 1} attempts`);
}
```

- Keep the timeout/retry behavior exactly as-is; this phase changes logging only.
- `wrangler tail shot-studio-uploads` now shows every dropped fan-out.
- Zero client risk. **Deploy immediately, independent of the rest.**

## Phase 2 — Liveness: real ping events + client watchdogs

Closes Hole A on web and mobile.

### 2a. Mobile parser guard — MUST SHIP FIRST (rollout hazard)

**File:** `mobile-app/src/lib/sse.ts`

The mobile parser hand-parses frames and reacts to any `data:` line whose JSON
lacks a matching `clientId`. Once the worker starts sending
`event: ping\ndata: {...}`, the **current** parser would treat every ping as a
foreign edit → `invalidateAll()` every 25s (a polling storm). The web client is
safe (named events never fire `onmessage`), but mobile must be updated and
OTA-published **before** the worker deploy.

Changes:
- Parse the `event:` field of each frame alongside `data:`. If
  `event === "ping"`, do **not** invalidate; instead feed the watchdog (below)
  and the seq check (Phase 3).
- Add a watchdog: record `lastFrameAt` on **every** frame (comment heartbeats
  aren't parseable as frames here — but pings will now be real frames). A
  `setInterval` (e.g. 15s) checks `Date.now() - lastFrameAt > WATCHDOG_MS`
  (60_000 ≈ 2.4× the 25s heartbeat); on trip: log
  `[live-sync] watchdog: no frames for 60s, reconnecting`, `controller.abort()`,
  and let the existing retry loop reconnect (`everConnected` already forces an
  `invalidateAll()` on reconnect — the resync).
- Keep the existing AppState foreground rebuild; the watchdog covers zombies
  *while foregrounded*, which AppState can't.

### 2b. Worker: heartbeat becomes a named event

**File:** `worker/src/sse-do.js`

- `ensureHeartbeat()`: change the frame from `": ping\n\n"` to
  `event: ping\ndata: {"seq":<n>}\n\n` (seq wired in Phase 3; until then send
  `{}`). Keep the 25s interval and the shared-timer lifecycle.
- Keep the opening `": connected\n\n"` comment as-is (harmless, matches Express
  legacy), but ALSO write one immediate ping right after subscribe so a fresh
  client arms its watchdog with a real frame straight away.
- Broadcast frames stay **unnamed** (`data: <json>\n\n`) — `onmessage` on web
  and the mobile edit path must keep working unchanged.

### 2c. Web hook: watchdog + ping listener

**File:** `src/lib/useProjectEvents.js`

Inside `connect()`:

```js
let lastFrameAt = Date.now();
const alive = () => { lastFrameAt = Date.now(); };
es.onopen = () => { alive(); /* existing resync logic */ };
es.onmessage = (e) => { alive(); /* existing edits logic */ };
es.addEventListener("ping", (e) => { alive(); /* Phase 3: seq check on e.data */ });
```

- One `setInterval` per effect (15s tick): if `Date.now() - lastFrameAt >
  WATCHDOG_MS` (60_000) → `console.warn("[live-sync] watchdog reconnect", path)`,
  set `hadError = true`, `es.close()`, `connect()`. The existing `onopen` then
  bumps `resyncs`, and RootLayout's existing resync reaction refetches — no new
  plumbing needed downstream.
- Clear the interval in the effect cleanup alongside `retryTimer`.
- The named `ping` event does NOT fire `onmessage`, so `edits` semantics are
  untouched (no false Script-tab glow every 25s).

### 2d. No Vite change needed

All three SSE routes already have unbuffered `sse()` proxy entries
(`vite.config.js:45-47`). Verify pings flow through in dev as part of testing.

## Phase 3 (optional but cheap) — Self-healing seq in pings

Catches "an event existed but my stream missed it" *without* a disconnect —
the UI then converges within one heartbeat (~25s) of any silent loss.

**Worker (`worker/src/sse-do.js`):**
- Per-channel in-memory counter: `this.seq = new Map()` (channel → int).
  `broadcast()` increments it and includes `seq` in the payload it frames
  (spread into the JSON: `{ ...payload, seq }`). Pings carry the current value:
  `event: ping\ndata: {"seq":<current>}`.
- In-memory only — eviction drops all sockets anyway, and every reconnect
  already forces a client resync, so a seq reset is absorbed by the
  reset-on-reconnect rule below. No DO storage.

**Clients (web `useProjectEvents.js`, mobile `sse.ts`):**
- Track `lastSeq` (start `null`; reset to `null` on every (re)connect — the
  connect-time resync already covers the gap).
- On a data frame: if `lastSeq !== null && payload.seq !== lastSeq + 1` → missed
  something → bump `resyncs` (web) / `invalidateAll()` (mobile). Then
  `lastSeq = payload.seq`.
- On a ping: if `lastSeq !== null && ping.seq > lastSeq` → an event was
  broadcast that never reached this client → same resync reaction, and set
  `lastSeq = ping.seq`.
- Echo-suppressed own-writes still advance `lastSeq` (the frame arrives; only
  the *reaction* is suppressed) — no false gaps.

**Limit (accepted):** a broadcast that never reached the DO at all (Hole B
double-failure) never increments seq, so seq can't detect it. Phase 1's logging
is the mitigation; a writer-side stamp (KV `lastWriteAt` read by the DO on each
ping) would close it fully but adds a KV read per heartbeat — not worth it now.

## Phase 4 — Docs

**File:** `docs/live-sync.md`
- Update the "Heartbeats stay SSE comments" design decision → heartbeats are now
  `event: ping` frames feeding client watchdogs + seq gap detection; comments
  documented as the *old* behavior.
- Add Holes 8 (zombie-OPEN) and 9 (silent broadcast drop) + fixes to the failure
  table.
- Extend the verification playbook with the checks below.

---

## Verification (manual — no automated infra covers this path)

1. **Ping visibility:** `curl -N '<worker>/api/data/events?projectId=<pid>'` →
   `event: ping` frame within ~25s (and one immediately on connect). Repeat
   through the dev proxy (`:3333`) to confirm unbuffered pass-through.
2. **Watchdog (web):** in dev, temporarily set `HEARTBEAT_MS` to 10 min in the
   DO, open a tab → within ~60s the console shows the watchdog reconnect and
   `resyncs` bumps (visible as a refetch in Network). Restore the constant.
3. **No ping-as-edit regressions:** with tabs idle on Script + Sounds for 2 min:
   no Script glow, no refetch storms, no mobile `invalidateAll` spam (watch the
   mobile console).
4. **Broadcast logging:** stop the worker's DO (or point `PROJECT_EVENTS` at a
   bogus binding locally) and make a write → `wrangler tail` /dev console shows
   the `DROPPED` line.
5. **Seq gap (Phase 3):** two tabs; DevTools-throttle tab B offline just long
   enough to miss one edit from tab A but not long enough to error the stream
   (or simulate by killing one DO writer via eviction in dev); tab B refetches
   on the next ping.
6. **End-to-end incident repro:** ask the flue agent for a script change → the
   draft-diff view appears on the Script tab with no Refresh; repeat for a world
   edit on another tab (regression check on the data channel).
7. **Echo suppression unchanged:** playbook item 2 from `docs/live-sync.md`.

## Rollout order (matters)

1. Phase 1 (worker logging) — deploy any time.
2. Phase 2a mobile parser guard → OTA publish (old mobile builds + new worker
   pings = 25s invalidate storm; web is immune).
3. Phase 2b/2c (+3) worker + web together (`npm run worker:deploy` ships both:
   the worker serves the SPA).
4. Phase 4 docs in the same PR as 2b/2c.

## Files touched

| File | Change |
|---|---|
| `worker/src/lib/broadcast.js` | log failed/dropped fan-outs |
| `worker/src/sse-do.js` | `event: ping` frames, connect-time ping, per-channel seq |
| `src/lib/useProjectEvents.js` | watchdog timer, `ping` listener, seq gap → resync |
| `mobile-app/src/lib/sse.ts` | parse `event:` field, ping ≠ edit, watchdog, seq |
| `docs/live-sync.md` | new failure modes, updated design decisions, playbook |
