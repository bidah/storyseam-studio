// Verify the short-lived HMAC token the shot-studio-uploads worker mints on every
// proxy hop and sets on `x-flue-proxy-user`. Ported verbatim in spirit from the
// eve channel's `verifyProxyToken` (agent/channels/eve.ts) — same payload shape
// `{ sub, iss: "shot-studio", exp }`, same key `FLUE_PROXY_SECRET` (was
// EVE_PROXY_SECRET). Web Crypto only, so it runs on the Workers runtime.

export const PROXY_HEADER = "x-flue-proxy-user";
const PROXY_ISSUER = "shot-studio";

function base64urlDecode(input: string): ArrayBuffer {
  const b64 =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// The shared HMAC secret. Prefer FLUE_PROXY_SECRET; fall back to the existing
// EVE_PROXY_SECRET so the already-provisioned value keeps working pre-rename.
export function proxySecret(): string | undefined {
  return process.env.FLUE_PROXY_SECRET ?? process.env.EVE_PROXY_SECRET;
}

export async function verifyProxyUser(
  token: string | null | undefined,
  secret: string,
): Promise<{ sub: string } | null> {
  if (!token) return null;
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
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sig,
    enc.encode(payloadPart),
  );
  if (!ok) return null;

  let payload: { sub?: unknown; iss?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadPart)),
    );
  } catch {
    return null;
  }
  if (payload.iss !== PROXY_ISSUER) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    return null;
  }
  return { sub: payload.sub };
}
