// The agent's signed identity for calls BACK to the shot-studio-uploads worker.
//
// A flue tool runs on a different origin from the app and has no Better Auth
// cookie, so for a long time its API calls carried no identity at all. The
// worker's ownership check had to skip anonymous callers to keep the tools
// working, which meant the same exemption was available to anyone on the
// internet who knew a project id.
//
// The fix is the credential the Higgsfield token bridge already used: a
// short-lived HMAC assertion over the user id, signed with the shared
// FLUE_PROXY_SECRET and issued as "shot-studio-agent" — the reverse direction of
// the `x-flue-proxy-user` header the worker mints on the way in. That user id is
// not something a tool chooses: it comes from the conversation's instance id,
// which app.ts has already verified against the inbound proxy token before any
// request reaches the agent. So the assertion can only ever name the user whose
// chat this actually is.
//
// The issuer differs from the inbound direction on purpose. The secret is
// shared, so with a single issuer an intercepted worker→agent token would verify
// when replayed straight back at the worker's API as its subject.
//
// Web Crypto only, so it runs on the Workers runtime.

export const AGENT_ISSUER = "shot-studio-agent";
export const AGENT_HEADER = "x-flue-agent-user";
// Not a credential — correlation only. The conversation a tool call came from,
// recorded next to the actor in doc_history. Unsigned on purpose: treating
// metadata as authority is what makes it worth forging.
export const AGENT_CHAT_HEADER = "x-flue-chat";

// Minted per request, never stored — long enough to outlive clock skew and a
// slow upstream, short enough that a leaked one is worthless.
const TTL_SECONDS = 300;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// FLUE_PROXY_SECRET is the name; EVE_PROXY_SECRET is the already-provisioned
// value it was renamed from.
export function agentSecret(): string | undefined {
  return process.env.FLUE_PROXY_SECRET ?? process.env.EVE_PROXY_SECRET;
}

export async function mintAgentAssertion(sub: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = b64url(
    enc.encode(
      JSON.stringify({
        sub,
        iss: AGENT_ISSUER,
        exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
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
