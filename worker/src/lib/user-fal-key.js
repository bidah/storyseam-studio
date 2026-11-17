// The author's own fal key, kept server-side — the ONLY key any render runs on.
//
// Every generation is paid by the author's fal account: StorySeam never lends
// its own key (the `FAL_KEY` secret is no longer read for a render). The
// browser still stamps the key on each request as `x-fal-key` (src/lib/falKey.js),
// but a Film runs 20–40 minutes with no request and no browser, and so does the
// Sitting runner in its Daytona box — they need the key from here. So the key
// the author saves is also stored, encrypted, per USER (not per project: one fal
// account pays for everything they make).
//
// Encryption: AES-GCM under a key derived (HKDF) from BETTER_AUTH_SECRET, so no
// new secret has to be provisioned. Rotating BETTER_AUTH_SECRET signs everyone
// out AND makes stored keys unreadable — `readUserFalKey` then returns null and
// the author is asked to connect fal again, exactly as if they never had.
//
// Per-USER platform data, so its own D1 table (`user_fal_keys`, worker/schema.sql)
// rather than the per-project `docs` store.

const INFO = new TextEncoder().encode("storyseam:user-fal-key:v1");
const MAX_KEY_CHARS = 200;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function cryptoKey(env) {
  const secret = env?.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set — fal keys cannot be stored");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A plausible fal key: one token, no spaces, not absurdly long. → error string or null. */
export function checkFalKey(key) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return "Paste your fal API key.";
  if (k.length > MAX_KEY_CHARS || /\s/.test(k)) return "That doesn't look like a fal API key.";
  return null;
}

export async function saveUserFalKey(env, userId, key) {
  const k = key.trim();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(env), new TextEncoder().encode(k));
  await env.DB.prepare(
    `INSERT INTO user_fal_keys (user_id, ciphertext, iv, last4, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv,
       last4 = excluded.last4, updated_at = excluded.updated_at`,
  )
    .bind(userId, b64(sealed), b64(iv), k.slice(-4), new Date().toISOString())
    .run();
}

export async function deleteUserFalKey(env, userId) {
  await env.DB.prepare("DELETE FROM user_fal_keys WHERE user_id = ?").bind(userId).run();
}

/** → { connected, last4, updatedAt } — never the key itself. */
export async function userFalKeyStatus(env, userId) {
  const row = await env.DB.prepare("SELECT last4, updated_at FROM user_fal_keys WHERE user_id = ?").bind(userId).first();
  return row ? { connected: true, last4: row.last4, updatedAt: row.updated_at } : { connected: false, last4: null, updatedAt: null };
}

/** The author's stored key, decrypted — null when there is none (or it can't be read). */
export async function readUserFalKey(env, userId) {
  if (!userId || !env?.DB) return null;
  const row = await env.DB.prepare("SELECT ciphertext, iv FROM user_fal_keys WHERE user_id = ?").bind(userId).first();
  if (!row) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv) }, await cryptoKey(env), unb64(row.ciphertext));
    return new TextDecoder().decode(plain) || null;
  } catch {
    return null;
  }
}

/**
 * The key a request renders with: the one the browser sent, else the author's
 * stored one. Never StorySeam's. "" when the author has none — callers refuse.
 */
export async function requestFalKey(c) {
  const sent = c.req.header("x-fal-key");
  if (sent) return sent;
  return (await readUserFalKey(c.env, c.get("userId"))) || "";
}

/**
 * `env` for work done on an author's behalf with no request (a Film job, the
 * Sitting runner): the same bindings, with `FAL_KEY` replaced by THEIR key —
 * "" when they have none, so every stage that reads it fails as "not set"
 * rather than quietly billing StorySeam.
 */
export async function envForUser(env, userId) {
  return { ...env, FAL_KEY: (await readUserFalKey(env, userId)) || "" };
}

export const NO_FAL_KEY =
  "Connect your fal API key in Settings › Connectors — every render runs on your own fal account.";
