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
