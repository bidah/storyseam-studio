// The short-lived HMAC tokens that carry an authenticated user id between the
// two workers. Both directions, one implementation.
//
// There are two hops, and they are deliberately NOT interchangeable:
//
//   worker → flue   `x-flue-proxy-user`, issuer "shot-studio"
//       The SPA is served from this worker and holds the Better Auth cookie;
//       the flue worker can't see it. So we mint the session user's id and the
//       agent verifies it (flue-agent/src/lib/proxy-auth.ts).
//
//   flue → worker   `x-flue-agent-user`, issuer "shot-studio-agent"
//       Agent tools call this worker's JSON API over plain HTTP with no cookie.
//       They used to send NO identity at all, which is why the ownership check
//       in index.js had to skip anonymous callers to keep them working — and
//       that hole was open to anyone on the internet who knew a project id.
//       Now the agent signs with the user it is already scoped to (the userId
//       encoded in its instance id, itself verified on the inbound hop), and
//       the check can fail closed.
//
// The two directions carry DIFFERENT issuers on purpose. The secret is shared,
// so without that separation a token minted for one hop would verify on the
// other — an intercepted worker→flue token could be replayed straight back at
// this worker's API as its subject. Same key, different audience, so say so.

export const PROXY_HEADER = "x-flue-proxy-user";
export const AGENT_HEADER = "x-flue-agent-user";
// Not a credential — correlation only. The conversation a tool call came from,
// recorded alongside the actor in doc_history so a change can be traced back to
// the chat that made it. Unsigned on purpose: it is metadata, and treating it as
// authority would make it worth forging.
export const AGENT_CHAT_HEADER = "x-flue-chat";

export const PROXY_ISSUER = "shot-studio";
export const AGENT_ISSUER = "shot-studio-agent";

// Short by design: these are minted per request hop, never stored, so there is
// no reason for one to outlive the request that created it by more than clock
// skew plus a slow render.
const TTL_SECONDS = 300;

function base64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input) {
  const b64 =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

export async function mintToken(userId, secret, issuer = PROXY_ISSUER) {
  const enc = new TextEncoder();
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        sub: String(userId),
        iss: issuer,
        exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      }),
    ),
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    enc.encode(payload),
  );
  return `${payload}.${base64url(sig)}`;
}

// The token's subject, or null if it is absent, malformed, expired, signed with
// the wrong key, or issued for the OTHER hop. Never throws — a bad token is an
// unauthenticated request, not a server error.
export async function verifyToken(token, secret, issuer = AGENT_ISSUER) {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sig;
  try {
    sig = base64urlDecode(sigPart);
  } catch {
    return null;
  }

  const enc = new TextEncoder();
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sig,
    enc.encode(payloadPart),
  );
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return null;
  }
  if (payload.iss !== issuer) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return payload.sub;
}

// The shared secret. FLUE_PROXY_SECRET is the name; EVE_PROXY_SECRET is the
// already-provisioned value it was renamed from.
export const proxySecret = (env) => env.FLUE_PROXY_SECRET || env.EVE_PROXY_SECRET;
