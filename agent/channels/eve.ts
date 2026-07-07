import { eveChannel } from "eve/channels/eve";
import { none, vercelOidc } from "eve/channels/auth";

// Local dev: the browser reaches the agent through the Vite dev-server proxy
// (`/eve` on :3333 → this server on :2000), so requests arrive same-origin from
// localhost.
//
// `localUser()` resolves loopback requests to a stable *user* principal. This
// matters for user-scoped connections: interactive OAuth (the Higgsfield
// sign-in) requires `principalType: "user"` and fails with `principal_required`
// otherwise, and the built-in `localDev()` / `none()` provide an anonymous /
// local-dev principal, not a user. It is loopback-gated, so it never applies to
// a real deployment (where `vercelOidc()` — or your own provider — takes over).
//
// ⚠️ For a real deployment, replace `none()` with your app's auth provider
// (Auth.js / Clerk / a session cookie) so the agent is not publicly callable.
function localUser() {
  return (request: Request) => {
    let loopback = false;
    try {
      const host = new URL(request.url).hostname;
      loopback =
        host === "localhost" ||
        host === "[::1]" ||
        host === "::1" ||
        host.endsWith(".localhost") ||
        /^127\./.test(host);
    } catch {
      return null;
    }
    if (!loopback) return null;
    return {
      attributes: {},
      authenticator: "local-dev",
      issuer: "shot-studio-local",
      principalId: "local-user",
      principalType: "user",
    };
  };
}

export default eveChannel({
  auth: [vercelOidc(), localUser(), none()],
});
