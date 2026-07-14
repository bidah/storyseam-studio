import { eveChannel } from "eve/channels/eve";
import { none, vercelOidc } from "eve/channels/auth";
import { setModelId, setProjectId } from "../lib/context";

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

// Deployed: the browser is same-origin with the Cloudflare Worker, which serves
// the SPA and holds the Better Auth session. The Worker proxies `/eve/*` to this
// (publicly reachable) Vercel agent, so a proxied request has no Vercel OIDC
// token and is not loopback — without help it would fall through to `none()`
// (anonymous), and the in-chat Higgsfield OAuth sign-in would fail with
// `principal_required` because it needs `principalType: "user"`.
//
// `proxiedUser()` closes that gap. On each proxy hop the Worker mints a
// short-lived HMAC-signed token (payload `{ sub: <better-auth user id>, iss,
// exp }`, key `EVE_PROXY_SECRET` shared by both sides) and sets it on
// `x-eve-proxy-user`; the Worker strips any client-supplied copy first, so the
// header can only originate from the trusted proxy. We verify the signature and
// expiry here and project the Better Auth user id into a `user` principal — the
// per-user identity the OAuth connection cache is keyed on.
//
// If `EVE_PROXY_SECRET` is unset or the token is missing/invalid we return null
// (skip), so anonymous chat via `none()` keeps working during rollout.
const PROXY_ISSUER = "shot-studio";
const PROXY_HEADER = "x-eve-proxy-user";

function base64urlDecode(input: string): ArrayBuffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function verifyProxyToken(
  token: string,
  secret: string,
): Promise<{ sub: string } | null> {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  let sig: ArrayBuffer;
  try {
    sig = base64urlDecode(sigPart);
  } catch {
    return null;
  }
  // Web Crypto compares the MAC internally, so the signature check is not a
  // timing side channel.
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(payloadPart));
  if (!ok) return null;

  let payload: { sub?: unknown; iss?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return null;
  }
  if (payload.iss !== PROXY_ISSUER) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return { sub: payload.sub };
}

function proxiedUser() {
  return async (request: Request) => {
    const secret = process.env.EVE_PROXY_SECRET;
    if (!secret) return null;
    const token = request.headers.get(PROXY_HEADER);
    if (!token) return null;
    const claims = await verifyProxyToken(token, secret);
    if (!claims) return null;
    return {
      attributes: {},
      authenticator: "shot-studio-proxy",
      issuer: PROXY_ISSUER,
      principalId: claims.sub,
      principalType: "user",
    };
  };
}

// The browser tags every request with the project it's viewing via the
// `x-project-id` header (injected by the SPA's fetch shim, see
// src/lib/projectFetch.js) and the Worker forwards it on the /eve proxy hop. The
// agent's Worker-API calls must target that same project, so we thread the id
// into per-session durable state that every tool reads (agent/lib/context.ts →
// agent/lib/api.ts).
//
// `onMessage` runs BEFORE runtime dispatch, outside the ALS scope, so writing
// durable state there throws ("onMessage handler failed"). Instead it stamps the
// id onto the caller's auth `attributes` — which DO survive into the dispatched
// session — and the in-scope `turn.started` lifecycle hook copies it into the
// state slot before any tool runs.
export default eveChannel({
  auth: [vercelOidc(), proxiedUser(), localUser(), none()],
  onMessage: (ctx) => {
    const caller = ctx.eve.caller;
    if (!caller) return { auth: null };
    // Two per-turn hints ride in on headers: the project the browser is viewing
    // (x-project-id) and the model the picker has selected (x-eve-model). Both
    // get stamped onto the caller's auth attributes here (which survive into the
    // dispatched session) and copied into durable state by `turn.started`.
    const headers = ctx.eve.request.headers;
    const projectId = headers.get("x-project-id");
    const modelId = headers.get("x-eve-model");
    if (!projectId && !modelId) return { auth: caller };
    const attributes = { ...caller.attributes };
    if (projectId) attributes.projectId = projectId;
    if (modelId) attributes.modelId = modelId;
    return { auth: { ...caller, attributes } };
  },
  events: {
    "turn.started": (_data, _channel, ctx) => {
      const attrs = ctx.session.auth.current?.attributes;
      // Only overwrite when the turn actually carries the attribute. An
      // inputResponses-only resume (HITL answers) skips `onMessage`, so its auth
      // has neither attribute — resetting to null here would make every
      // post-interview tool call (e.g. save_world) fall back to the wrong
      // project, and would drop the picked model back to the default mid-chat.
      // Keep whatever the message that started the conversation set.
      const projectId = attrs?.projectId;
      if (typeof projectId === "string" && projectId) setProjectId(projectId);
      const modelId = attrs?.modelId;
      if (typeof modelId === "string" && modelId) setModelId(modelId);
    },
  },
});
