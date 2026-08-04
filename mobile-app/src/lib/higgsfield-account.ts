// Higgsfield as a CONNECTOR — mobile port of the web's src/lib/higgsfieldAccount.js.
// Since sign-in moved to Google, the Higgsfield OAuth account is something you
// LINK to the signed-in user (Better Auth genericOAuth /oauth2/link) rather than
// the way in. The link stores the per-user Higgsfield bearer on the account row,
// which is what the worker's render/import paths use.
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { authClient } from './auth-client';

// One cache entry for the session's linked-account list; the settings sheet
// invalidates it after connect/disconnect.
export const LINKED_ACCOUNTS_KEY = ['auth', 'linked-accounts'] as const;

export function useLinkedAccounts() {
  return useQuery({
    queryKey: LINKED_ACCOUNTS_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message || 'Could not load linked accounts');
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

// null while unknown (first load in flight), 'error' when the list couldn't be
// fetched, else boolean — same contract as the web hook.
export function useHiggsfieldLinked(): boolean | null | 'error' {
  const { data, isError } = useLinkedAccounts();
  if (isError) return 'error';
  if (!data) return null;
  return data.some((a) => a.providerId === 'higgsfield');
}

// Start the Higgsfield OAuth link flow for the CURRENT session. /oauth2/link is
// not one of the paths the Better Auth Expo plugin auto-opens a browser for
// (only /sign-in* and /link-social are), so open the returned authorize URL
// ourselves. The plugin still does the rest: it attaches the stored session
// cookie to the POST and rewrites the relative callbackURL into a deep link —
// the worker redirects there after the OAuth callback, which is what closes the
// auth session. No new cookie comes back and none is needed: the callback
// resolves the target user from server-side link state, and the app's session
// is unchanged.
//
// Resolves true when the browser round-trip completed, false when the author
// dismissed it (the link may not exist — recheck the account list either way).
export async function connectHiggsfield(): Promise<boolean> {
  const { data, error } = await authClient.oauth2.link({
    providerId: 'higgsfield',
    callbackURL: '/settings',
  });
  const url = (data as { url?: string } | null)?.url;
  if (error || !url) throw new Error(error?.message || 'Could not start the Higgsfield link');
  const result = await WebBrowser.openAuthSessionAsync(url, Linking.createURL('/settings'));
  return result.type === 'success';
}

export async function disconnectHiggsfield(): Promise<void> {
  const { error } = await authClient.unlinkAccount({ providerId: 'higgsfield' });
  if (error) throw new Error(error.message || 'Could not disconnect Higgsfield');
}
