import {
  defineMcpClientConnection,
  defineInteractiveAuthorization,
  ConnectionAuthorizationRequiredError,
  ConnectionAuthorizationFailedError,
} from "eve/connections";
import {
  startLogin,
  completeLogin,
  currentToken,
  type StartState,
} from "../lib/higgsfield-oauth.js";
import { workerHiggsfieldToken } from "../lib/worker-token.js";

// Higgsfield MCP — the generation backend our skills (seed-audio,
// generate-multishot, continue-video, video-from-audio-vfx) drive to render
// audio/video.
//
// The endpoint is an OAuth 2.0 protected resource (no API key): unauthenticated
// calls get a `401 Bearer`. Token resolution order:
//   1. HIGGSFIELD_MCP_TOKEN env — pre-provisioned static bearer (CI/service).
//   2. Worker token bridge (`agent/lib/worker-token.ts`) — the app login IS
//      "Sign in with Higgsfield", so the Worker holds and refreshes the user's
//      bearer; the agent fetches it with an EVE_PROXY_SECRET-signed assertion.
//   3. Interactive OAuth from the chat panel (authorization-code + PKCE; eve
//      hosts the redirect callback) — the fallback when the bridge has no
//      credential for this principal. See `agent/lib/higgsfield-oauth.ts`.
//
// Until HIGGSFIELD_MCP_URL is set, this points at a harmless localhost
// placeholder so the agent still boots (generation tools just won't resolve).
const url = process.env.HIGGSFIELD_MCP_URL || "http://localhost:9";

// A pre-provisioned bearer (CI / service use) short-circuits the interactive
// flow entirely.
const staticToken = process.env.HIGGSFIELD_MCP_TOKEN || undefined;

function principalKey(principal: { type: string; id?: string; issuer?: string }): string {
  return principal.type === "user"
    ? `${principal.issuer ?? ""}:${principal.id ?? ""}`
    : "app";
}

export default defineMcpClientConnection({
  url,
  description:
    "Higgsfield generation MCP: image/video/audio (Seedance, Seed Audio), used by the render skills.",
  auth: staticToken
    ? { getToken: async () => ({ token: staticToken }) }
    : defineInteractiveAuthorization<StartState>({
        async getToken({ principal }) {
          // The app login IS "Sign in with Higgsfield", so the Worker already
          // holds (and refreshes) this user's Higgsfield bearer — reuse it
          // instead of demanding a second, agent-only sign-in.
          const bridged = await workerHiggsfieldToken(principal);
          if (bridged) return bridged;
          const tok = await currentToken(url, principalKey(principal));
          if (tok) return tok;
          throw new ConnectionAuthorizationRequiredError("higgsfield");
        },
        async startAuthorization({ callbackUrl }) {
          const { url: authUrl, state } = await startLogin(url, callbackUrl);
          return {
            challenge: {
              url: authUrl,
              displayName: "Higgsfield",
              instructions:
                "Sign in to Higgsfield to enable image, video, and audio generation.",
            },
            resume: state,
          };
        },
        async completeAuthorization({ principal, resume, callback }) {
          const p = callback.params;
          if (p.error) {
            throw new ConnectionAuthorizationFailedError("higgsfield", {
              reason: p.error,
              retryable: p.error !== "access_denied",
              message: p.error_description || p.error,
            });
          }
          if (!resume) {
            throw new ConnectionAuthorizationFailedError("higgsfield", {
              message: "Missing OAuth flow state.",
            });
          }
          if (!p.state || p.state !== resume.state) {
            throw new ConnectionAuthorizationFailedError("higgsfield", {
              reason: "state_mismatch",
              retryable: false,
              message: "OAuth state mismatch.",
            });
          }
          if (!p.code) {
            throw new ConnectionAuthorizationFailedError("higgsfield", {
              message: "No authorization code returned.",
            });
          }
          return completeLogin(url, principalKey(principal), resume, p.code);
        },
      }),
});
