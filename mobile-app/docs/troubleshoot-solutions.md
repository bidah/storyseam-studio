# Troubleshoot solutions

A running log of bugs that took real digging, with the confirmed root cause and
the shipped fix — so the same symptom never has to be re-diagnosed from scratch.

---

## First Higgsfield OAuth login lands back on /sign-in; second login works (2026-07-16)

**Symptom.** Tap "Sign in with Higgsfield" → the auth browser modal opens, the
user authorizes, the modal closes and we're back in the app — but on the
**sign-in page**, not logged in. Doing the exact same login a second time works
and lands in the app signed in. Deterministic: first attempt always fails,
second always succeeds.

**What it was NOT.** The OAuth flow itself is fine: `@better-auth/expo`'s
`signIn.oauth2` awaits `openAuthSessionAsync`, the deep-link redirect
(`mobileapp:///chat?cookie=…`) is captured, and the session cookie is stored in
SecureStore *before* the call resolves. Server (`worker/src/auth.js`,
`expo()` + `genericOAuth` plugins, better-auth 1.6.23 on both sides) creates the
session correctly on the first attempt.

**Root cause — stale session atom + route-guard race.**

1. On app boot, `src/app/index.tsx` redirects to `/chat`; the `(tabs)` guard
   (`useSession` in `src/app/(tabs)/_layout.tsx`) fetches the session (none),
   leaves better-auth's session **atom** at `{ data: null, isPending: false }`,
   and bounces to `/sign-in`. The guard then unmounts.
2. After OAuth succeeds, the Expo plugin stores the cookie and fires
   `$sessionSignal` — but the signal→refetch listener lives inside the session
   atom's nanostores `onMount`, so with no `useSession` subscriber mounted
   (the auth screens don't use it), **nothing refetches the atom**.
3. `router.replace('/chat')` mounts the tabs guard. Its first render reads the
   stale `{ data: null, isPending: false }` snapshot → renders
   `<Redirect href="/sign-in" />`. The child Redirect's navigation effect runs
   before the atom's mount-refetch (scheduled via `setTimeout(0)`) can land →
   bounced back to sign-in.
4. Why the **second** attempt works: nanostores keeps a store mounted ~1 s after
   its last unsubscribe (`STORE_UNMOUNT_DELAY`), so the bounced mount's late
   refetch still ran and populated the atom with the (already valid) session.
   The next `/chat` navigation reads real data and passes the guard.

The email sign-in and sign-up paths had the identical latent race.

**Fix.** Verify the session AND seed the atom before navigating:
`confirmSignedIn()` in `src/lib/auth-client.ts` calls
`getSession({ query: { disableCookieCache: true } })` and on success writes the
result into `authClient.$store.atoms.session` (the same internal the Expo
plugin uses to null the atom on sign-out), then returns `true`. All three auth
paths — Higgsfield OAuth, email sign-in (`sign-in.tsx`), and sign-up
(`sign-up.tsx`) — call it before `router.replace('/chat')`. A dismissed browser
resolves without error and without a session → `confirmSignedIn()` returns
`false` → we toast instead of navigating.

**Rule of thumb.** Any screen that navigates into `(tabs)` right after changing
auth state must go through `confirmSignedIn()`; `router.replace` on its own
races the guard's stale atom snapshot.

---

## "Jump to latest" in chat won't scroll; every imperative scroll is a no-op (2026-07-20)

**Symptom.** The chat transcript is an inverted `FlatList`. The down-arrow
"jump to latest" button either jumped instantly (old remount trick) or, once
"fixed" with `scrollToOffset`, did nothing at all. Callers wanted an *animated*
scroll to the newest message.

**Root cause — confirmed on-device (iPhone 17 sim, dev build).** On this stack
(Expo SDK 57 / RN 0.86 / React 19 / New Architecture / React Compiler /
Reanimated 4.5) **every imperative scroll path is dead**, verified by logging:

- `FlatList.scrollToOffset` / `scrollToEnd` — no-op. `getNativeScrollRef()`
  returns `null` (the inner `_scrollRef` never attaches), so there's nothing to
  call `.scrollTo` on. The methods exist but do nothing.
- A plain `<ScrollView>` `useRef` — `ref.current` is **null** (`hasRef:false`).
- Reanimated `scrollTo(useAnimatedRef, …)` — warns *"Tried to dispatch command
  scrollTo with an uninitialized ref"*; `useAnimatedRef` never captures the
  Fabric tag (even though a `useAnimatedScrollHandler` on the SAME view works,
  reading offsets fine).
- `Animated.FlatList` — crashes: `Cannot read property '__internalInstanceHandle'
  of null` in reanimated's `fabricUtils`.

Only native gestures move the list. This is why the original code used an
inverted list (auto-pins to newest with no scroll calls) + a remount for jump.

**Fix.** Scroll via a **controlled `contentOffset`** — a *prop*, not a ref.
Keep the inverted `FlatList` (virtualization + streaming pin) and inject an
`Animated.ScrollView` as its scroll view via `renderScrollComponent`
(`cloneElement` clobbers `ref` but NOT `animatedProps`). Track the live offset
in a shared value from `onScroll`; on jump, `withTiming` a `jumpTarget` shared
value from the current offset to `0` (newest, since inverted) and feed it as
`contentOffset` through `useAnimatedProps`. Crucially, `animatedProps` yields
`{}` while not animating, so native momentum scrolling is untouched the rest of
the time. See the header comment in `src/app/(tabs)/chat/index.tsx`.

**Rule of thumb.** Don't reach for `scrollToOffset`/`scrollToEnd`/`scrollTo` or
`useAnimatedRef` to move a list on this stack — they silently no-op or crash.
Animate a controlled `contentOffset` instead.

---

## Tab shows stale data after the agent finishes; manual Refresh fixes it (2026-07-19)

**Symptom.** The agent finishes `save_shotlist`. Switching from Script to
Shotlist still shows the old shot list; pressing Refresh shows the new one.
Reported on web; the mobile app had a separate, independent version of the same
class of bug.

**What it was NOT.** The write and broadcast path is correct end to end. The
agent writes through the Worker (`agent/tools/save_shotlist.ts` →
`POST /api/shotlist`), and the generic post-mutation middleware
(`worker/src/index.js:182-204`) broadcasts `channel:"data"` for every successful
non-GET `/api/*` — `/api/shotlist` is not in the skip list. The DO keying
matches on both sides, and the agent sends no `x-client-id`, so its writes are
never echo-suppressed. There is no key mismatch to find: `RootLayout` calls
`invalidateTabCache()` with **no key**, which clears the entire store.

**Root cause (web) — a self-sustaining revalidation storm.**
`useRevalidator()` re-memoizes its return value on every `state.revalidation`
flip (`useMemo(() => ({revalidate, state: state.revalidation}), [revalidate,
state.revalidation])`); only the inner `revalidate` fn is stable. Four routes
had:

```js
const refetch = useCallback(() => { invalidateTabCache(k); revalidator.revalidate(); }, [revalidator]);
useEffect(() => { if (agent.status === "ready") refetch(); }, [agent.status, refetch]);
```

Level-triggered on the *steady* idle state (`"ready"` is idle — `agentIsBusy` is
submitted/streaming) **and** keyed off the unstable object: revalidate →
identity churn → effect re-fires → revalidate → … React Router interrupts an
in-flight revalidation when a new one starts, so the loader result may never
commit and `useLoaderData()` stays pinned to the previously committed payload.
`cuts.jsx` had already hit this once and fixed it locally (there it showed up as
the `<video>` nonce bumping and playback snapping to 0) — the same mistake
survived in `shotlist`, `world`, `radio`, and `episode`.

**Fix (web).** `useRevalidateOnAgentIdle(key, status)` in `src/lib/swr.js`:
edge-triggered on the transition **into** `"ready"` via a `prevStatus` ref, and
destructures `revalidate` so the dep is the stable fn, not the object. All five
routes use it. `refetch` callbacks now also dep on `revalidator.revalidate`.

**Fix (mobile).** Three independent gaps, none of which is the web bug:
1. `<LiveSync/>` was mounted *inside* `<AgentProvider>`, which renders `null`
   until the eve session publishes an agent — live-sync could not start until
   chat came up. Moved out, under `<ProjectGate>`.
2. `sse.ts` swallowed every failure into a silent 3 s reconnect loop, so a
   permanently-failing stream (e.g. a 403 from the ownership guard when the
   cookie doesn't survive the fetch shim) was indistinguishable from "connected
   and idle". Now warns on first failure and every 10th, and on recovery.
3. No local fallback: `onFinish` only persisted the transcript. It now also
   invalidates `[projectId]`, the always-available signal that a turn wrote
   something — the mobile counterpart of the web hook above.

**Rule of thumb.** Never level-trigger on `agent.status === "ready"`, and never
put the `revalidator` OBJECT in a dep array — destructure `revalidate`. Refresh
on a turn ending is an EDGE, not a state.

**Still open.** Mobile has no `/api/script/events` subscriber (web:
`RootLayout.jsx:207`), and the Worker deliberately excludes `/api/script*` from
the data firehose — so agent script edits never live-update on mobile.
