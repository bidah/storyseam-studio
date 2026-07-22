import { describe, it, expect } from "vitest";
import { verifyProxyUser, proxySecret, PROXY_HEADER } from "../../flue-agent/src/lib/proxy-auth";

// Mint a token exactly the way the shot-studio-uploads worker does: a base64url
// JSON payload `{ sub, iss, exp }`, dot, then base64url(HMAC-SHA256(payload)).
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mint(
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const enc = new TextEncoder();
  const payloadPart = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart));
  return `${payloadPart}.${b64url(sig)}`;
}

const SECRET = "test-secret";
const future = () => Math.floor(Date.now() / 1000) + 300;
const past = () => Math.floor(Date.now() / 1000) - 300;

describe("verifyProxyUser", () => {
  it("exposes the proxy header name", () => {
    expect(PROXY_HEADER).toBe("x-flue-proxy-user");
  });

  it("accepts a valid, unexpired, correctly-signed token", async () => {
    const token = await mint(SECRET, { sub: "user-123", iss: "shot-studio", exp: future() });
    expect(await verifyProxyUser(token, SECRET)).toEqual({ sub: "user-123" });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await mint("other-secret", { sub: "u", iss: "shot-studio", exp: future() });
    expect(await verifyProxyUser(token, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await mint(SECRET, { sub: "u", iss: "shot-studio", exp: past() });
    expect(await verifyProxyUser(token, SECRET)).toBeNull();
  });

  it("rejects a wrong issuer", async () => {
    const token = await mint(SECRET, { sub: "u", iss: "somebody-else", exp: future() });
    expect(await verifyProxyUser(token, SECRET)).toBeNull();
  });

  it("rejects a missing sub", async () => {
    const token = await mint(SECRET, { iss: "shot-studio", exp: future() });
    expect(await verifyProxyUser(token, SECRET)).toBeNull();
  });

  it("rejects null / malformed tokens without throwing", async () => {
    expect(await verifyProxyUser(null, SECRET)).toBeNull();
    expect(await verifyProxyUser("", SECRET)).toBeNull();
    expect(await verifyProxyUser("no-dot", SECRET)).toBeNull();
    expect(await verifyProxyUser(".sigonly", SECRET)).toBeNull();
  });
});

describe("proxySecret env resolution", () => {
  it("prefers FLUE_PROXY_SECRET, falling back to EVE_PROXY_SECRET", () => {
    const saved = { f: process.env.FLUE_PROXY_SECRET, e: process.env.EVE_PROXY_SECRET };
    try {
      process.env.FLUE_PROXY_SECRET = "flue";
      process.env.EVE_PROXY_SECRET = "eve";
      expect(proxySecret()).toBe("flue");
      delete process.env.FLUE_PROXY_SECRET;
      expect(proxySecret()).toBe("eve");
    } finally {
      const restore = (k: string, v: string | undefined) =>
        v === undefined ? delete process.env[k] : (process.env[k] = v);
      restore("FLUE_PROXY_SECRET", saved.f);
      restore("EVE_PROXY_SECRET", saved.e);
    }
  });
});
