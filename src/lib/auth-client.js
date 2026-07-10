// Better Auth browser client. The app is served same-origin by the Worker, so
// the default basePath (/api/auth on the current origin) is correct; the session
// lives in a cookie sent with same-origin requests.
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});
export const { signIn, signUp, signOut, useSession } = authClient;
