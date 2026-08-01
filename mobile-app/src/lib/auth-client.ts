import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import { genericOAuthClient } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';
import { API_ORIGIN } from './env';

// Better Auth client against the Worker (same server the web app uses). The
// Expo plugin persists the session cookie in SecureStore; api.ts attaches it
// manually to every request via authClient.getCookie().
export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  plugins: [
    expoClient({
      scheme: 'mobileapp',
      storagePrefix: 'shot-studio',
      storage: SecureStore,
    }),
    genericOAuthClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;

// Write a session we fetched ourselves into the atom `useSession` reads, so the
// next component to mount reads it settled instead of pending.
//
// Two callers, same need: `confirmSignedIn` below (post-OAuth, see the note
// there) and the cold-start path (lib/boot.ts), which resolves the session
// behind the splash screen. Better Auth's own on-mount refetch then keeps
// `isPending` false — it computes it as `data === null`, so a seeded atom
// refetches in the background instead of blanking the screen.
//
// Only a REAL session is worth seeding: writing null back would clear
// `isPending` for one render and set it again the moment the refetch starts,
// which is a redirect to /sign-in and back.
export function seedSession(data: unknown): boolean {
  if (!data) return false;
  const sessionAtom = (authClient as any).$store?.atoms?.session;
  if (!sessionAtom) return false;
  sessionAtom.set({
    ...sessionAtom.get(),
    data,
    error: null,
    isPending: false,
    isRefetching: false,
  });
  return true;
}

// Confirms a sign-in/sign-up actually produced a session, and seeds the
// session *atom* with it before the caller navigates into (tabs).
//
// Why seeding is required: the (tabs) guard redirects to /sign-in the moment
// `useSession` reports `{ data: null, isPending: false }` — and that is
// exactly the stale value the atom holds after the boot-time bounce
// (index → /chat → no session → /sign-in). While the auth screens are up
// nothing subscribes to the atom, so the `$sessionSignal` notify fired when
// the OAuth deep-link cookie lands never triggers a refetch. Navigating on a
// verified session without seeding loses the race: the guard's first render
// reads the stale null and bounces back to /sign-in (the "first Higgsfield
// login lands on the login page, second one works" bug — the second works
// only because the bounced mount's late refetch populated the atom).
export async function confirmSignedIn(): Promise<boolean> {
  const { data } = await authClient.getSession({ query: { disableCookieCache: true } });
  if (!data) return false;
  seedSession(data);
  return true;
}
