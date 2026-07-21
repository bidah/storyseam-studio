// Bridge to the shot-studio-uploads Worker's per-user Higgsfield token. Ported
// from eve's agent/lib/worker-token.ts. The app login IS "Sign in with
// Higgsfield", so the worker already holds and refreshes each user's bearer;
// the agent fetches it with a short-lived HMAC assertion signed with the shared
// FLUE_PROXY_SECRET (reverse of the `x-flue-proxy-user` proxy header).
//
// Web Crypto + fetch only, so it runs on the Workers runtime.

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
 * The signed-in user's Higgsfield bearer, fetched from the worker (which
 * refreshes it as needed). Returns null when the bridge can't help — no shared
 * secret, no user id, or the user has no usable credential.
 */
export async function workerHiggsfieldToken(
  userId: string,
): Promise<{ token: string; expiresAt?: number } | null> {
  const secret = process.env.FLUE_PROXY_SECRET ?? process.env.EVE_PROXY_SECRET;
  const api = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";
  if (!secret || !userId) return null;
  try {
    const assertion = await mintAssertion(userId, secret);
    const res = await fetch(`${api}/api/agent/higgsfield-token`, {
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
