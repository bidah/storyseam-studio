// The Sitting runner's job token (Auto, PRD #59 / #69, ADR 0001).
//
// The runner page is loaded by headless Chromium in a Daytona box, which has no
// session cookie and must never hold a fal key. What it carries instead is ONE
// short-lived HMAC token, minted by the Film job's sitting stage, that names
// exactly one sitting: which Film, which project and episode, which Series,
// which attempt, for which user. Every `/api/sitting-runner/*` route verifies it
// and scopes itself to those claims — the token IS the credential, the way a
// share token is for `/api/share/`.
//
// Same construction as lib/proxy-token.js (HMAC-SHA256 over a base64url JSON
// payload, the shared FLUE_PROXY_SECRET), with its OWN issuer so a token minted
// for either of the proxy hops can never verify here or vice versa. It lives
// longer than those (they are per-request; this one outlives a whole sitting,
// boot to upload) and carries more than a subject.
import { proxySecret } from "./proxy-token.js";

export const SITTING_TOKEN_HEADER = "x-sitting-token";
export const SITTING_ISSUER = "shot-studio-sitting";

/**
 * How long a runner token is good for: long enough for a box to boot, a 5:00
 * Film's slowest sitting (generation runs well behind realtime) and the upload;
 * short enough that a leaked one is dead before anyone can do much with it.
 */
export const SITTING_TOKEN_TTL_SECONDS = 60 * 60;

function base64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

/**
 * Mint a runner token.
 * claims: { filmId, projectId, episodeId?, seriesId, userId, attempt }
 */
export async function mintSittingToken(claims, secret, { now = Date.now(), ttl = SITTING_TOKEN_TTL_SECONDS } = {}) {
  if (!secret) throw new Error("No proxy secret to sign the Sitting runner's token with (FLUE_PROXY_SECRET).");
  const enc = new TextEncoder();
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        iss: SITTING_ISSUER,
        sub: String(claims.filmId),
        pid: String(claims.projectId),
        ep: claims.episodeId ? String(claims.episodeId) : null,
        sid: String(claims.seriesId),
        uid: String(claims.userId || ""),
        att: Number(claims.attempt) || 1,
        exp: Math.floor(now / 1000) + ttl,
      }),
    ),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(payload));
  return `${payload}.${base64url(sig)}`;
}

/**
 * The token's claims — `{ filmId, projectId, episodeId, seriesId, userId,
 * attempt }` — or null if it is absent, malformed, expired, forged or issued
 * for another purpose. Never throws.
 */
export async function verifySittingToken(token, secret, { now = Date.now() } = {}) {
  if (!token || !secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadPart = token.slice(0, dot);
  let sig;
  try {
    sig = base64urlDecode(token.slice(dot + 1));
  } catch {
    return null;
  }
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, new TextEncoder().encode(payloadPart));
  } catch {
    return null;
  }
  if (!ok) return null;
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return null;
  }
  if (p?.iss !== SITTING_ISSUER) return null;
  if (typeof p.exp !== "number" || p.exp * 1000 < now) return null;
  if (!p.sub || !p.pid || !p.sid) return null;
  return {
    filmId: p.sub,
    projectId: p.pid,
    episodeId: p.ep || null,
    seriesId: p.sid,
    userId: p.uid || null,
    attempt: Number(p.att) || 1,
  };
}

/** The runner's token off a request: the header, or `?t=` for a plain GET. */
export async function sittingClaims(c) {
  const token = c.req.header(SITTING_TOKEN_HEADER) || c.req.query("t");
  return verifySittingToken(token, proxySecret(c.env));
}
