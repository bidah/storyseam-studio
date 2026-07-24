// Better Auth browser client. The app is served same-origin by the Worker, so
// the default basePath (/api/auth on the current origin) is correct; the session
// lives in a cookie sent with same-origin requests.
//
// Desktop (Electron) quirk: the SPA's origin is app://shot-studio, which Better
// Auth's URL validation rejects (http/https only). Give it a placeholder http
// base and rewrite every request back to a RELATIVE same-origin path — those go
// through the desktop origin bridge, which forwards them to the Worker with the
// session cookie jar attached.
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

const DESKTOP_BASE = "http://desktop.local";
const onDesktop = typeof window !== "undefined" && !!window.desktop;

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
  ...(onDesktop
    ? {
        baseURL: DESKTOP_BASE,
        fetchOptions: {
          customFetchImpl: (input, init) => {
            const url = typeof input === "string" ? input : input?.url || String(input);
            return fetch(url.replace(DESKTOP_BASE, ""), init);
          },
        },
      }
    : {}),
});
export const { signIn, signUp, signOut, useSession } = authClient;
