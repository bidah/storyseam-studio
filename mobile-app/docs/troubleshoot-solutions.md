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
