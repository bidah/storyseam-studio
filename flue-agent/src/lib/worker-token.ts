// Bridge to the shot-studio-uploads Worker's per-user Higgsfield token. Ported
// from eve's agent/lib/worker-token.ts. The app login IS "Sign in with
// Higgsfield", so the worker already holds and refreshes each user's bearer;
// the agent fetches it with a short-lived HMAC assertion signed with the shared
// FLUE_PROXY_SECRET (reverse of the `x-flue-proxy-user` proxy header).
//
// Web Crypto + fetch only, so it runs on the Workers runtime.
//
// The assertion itself now lives in lib/agent-identity.ts, because every tool
// call carries the same credential — this bridge was just the first thing that
// needed it.

import { mintAgentAssertion, agentSecret } from "./agent-identity.js";

/**
 * The signed-in user's Higgsfield bearer, fetched from the worker (which
 * refreshes it as needed). Returns null when the bridge can't help — no shared
 * secret, no user id, or the user has no usable credential. Pass `force` to make
 * the worker refresh the token unconditionally (`?force=1`), used to recover from
 * a stale bearer mid-conversation.
 */
export async function workerHiggsfieldToken(
  userId: string,
  force = false,
): Promise<{ token: string; expiresAt?: number } | null> {
  const secret = agentSecret();
  const api = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";
  if (!secret || !userId) return null;
  try {
    const assertion = await mintAgentAssertion(userId, secret);
    const res = await fetch(
      `${api}/api/agent/higgsfield-token${force ? "?force=1" : ""}`,
      { headers: { authorization: `Bearer ${assertion}` } },
    );
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
