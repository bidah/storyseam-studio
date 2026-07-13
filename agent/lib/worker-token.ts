// Bridge to the Shot Studio Worker's per-user Higgsfield token.
//
// The app login IS "Sign in with Higgsfield" (Better Auth genericOAuth), so the
// Worker already holds — and auto-refreshes — a Higgsfield bearer for every
// signed-in user. Instead of making the user sign in a second time through the
// agent's own interactive OAuth, `getToken` first asks the Worker for that
// token: GET /api/agent/higgsfield-token, authenticated with a short-lived
// HMAC assertion signed with the shared EVE_PROXY_SECRET (the reverse direction
// of the `x-eve-proxy-user` header the Worker mints on the /eve proxy hop).
//
// Uses only `fetch` + Web Crypto (no `node:` builtins), like the rest of the
// connection code, so it bundles for the eve workflow runtime.

const API = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";
const ASSERTION_ISSUER = "shot-studio-agent";
const ASSERTION_TTL_SECONDS = 300;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintAssertion(sub: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = b64url(
    enc.encode(
      JSON.stringify({
        sub,
        iss: ASSERTION_ISSUER,
        exp: Math.floor(Date.now() / 1000) + ASSERTION_TTL_SECONDS,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/**
 * The signed-in user's Higgsfield bearer, fetched from the Worker (which
 * refreshes it as needed). Returns null when the bridge can't help — no shared
 * secret, non-user principal, or the user has no usable credential — in which
 * case the caller falls back to the agent's own interactive OAuth.
 */
export async function workerHiggsfieldToken(principal: {
  type: string;
  id?: string;
}): Promise<{ token: string; expiresAt?: number } | null> {
  const secret = process.env.EVE_PROXY_SECRET;
  if (!secret || principal.type !== "user" || !principal.id) return null;
  try {
    const assertion = await mintAssertion(principal.id, secret);
    const res = await fetch(`${API}/api/agent/higgsfield-token`, {
      headers: { authorization: `Bearer ${assertion}` },
    });
    if (!res.ok) return null;
    const { token, expiresAt } = (await res.json()) as {
      token?: string;
      expiresAt?: number;
    };
    return token ? { token, expiresAt } : null;
  } catch {
    return null;
  }
}
