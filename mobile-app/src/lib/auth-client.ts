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
  const sessionAtom = (authClient as any).$store?.atoms?.session;
  if (sessionAtom) {
    sessionAtom.set({
      ...sessionAtom.get(),
      data,
      error: null,
      isPending: false,
      isRefetching: false,
    });
  }
  return true;
}
