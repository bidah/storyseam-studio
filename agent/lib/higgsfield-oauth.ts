// OAuth 2.0 for the Higgsfield MCP — authorization-code + PKCE with dynamic
// client registration (the server issues a public client, no pre-shared
// secret). Deliberately uses only `fetch` + Web Crypto (no `node:` builtins),
// so it bundles for the eve workflow runtime exactly like the tools do.
//
// Durable state (the registered client id + the refresh token) is persisted
// through the Shot Studio API's `/api/secrets` KV rather than in memory or on
// disk: eve's own token cache does not hold refresh tokens, and durable
// workflow steps do not share process memory, so the credential must live
// somewhere both the auth step and a later `getToken` can read it back.

const API = process.env.SHOT_STUDIO_API ?? "http://localhost:3334";
const SCOPE = "openid email offline_access";

// Carried (journaled) from startAuthorization to completeAuthorization. The
// index signature keeps it assignable to eve's `JsonValue` resume constraint.
export type StartState = {
  verifier: string;
  state: string;
  clientId: string;
  redirectUri: string;
  [k: string]: string;
};

interface Stored {
  clientId: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // ms since the Unix epoch
}

interface Meta {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

// --- persistence via the Shot Studio API -----------------------------------

async function getSecret<T>(key: string): Promise<T | null> {
  const res = await fetch(`${API}/api/secrets/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`secrets get ${key}: ${res.status}`);
  const { value } = (await res.json()) as { value: T };
  return value;
}

async function putSecret(key: string, value: unknown): Promise<void> {
  const res = await fetch(`${API}/api/secrets/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`secrets put ${key}: ${res.status}`);
}

// --- authorization-server metadata discovery (cached in-module) ------------

let metaPromise: Promise<Meta> | null = null;
function discover(mcpUrl: string): Promise<Meta> {
  if (!metaPromise) {
    const base = new URL(mcpUrl).origin;
    metaPromise = fetch(`${base}/.well-known/oauth-authorization-server`)
      .then((r) => {
        if (!r.ok) throw new Error(`AS metadata ${r.status}`);
        return r.json() as Promise<Meta>;
      })
      .catch((e) => {
        metaPromise = null; // let the next attempt retry discovery
        throw e;
      });
  }
  return metaPromise;
}

// --- PKCE (Web Crypto) ------------------------------------------------------

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomB64url(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(digest);
}

// --- dynamic client registration (cached per redirect URI) ------------------

async function getClientId(mcpUrl: string, redirectUri: string): Promise<string> {
  // One registered client per redirect URI (the server binds the client to its
  // redirect_uris). Keyed by a constant, storing the URI so we re-register if
  // the callback base ever changes.
  const cacheKey = "higgsfield:client";
  const cached = await getSecret<{ clientId: string; redirectUri: string }>(cacheKey);
  if (cached && cached.redirectUri === redirectUri) return cached.clientId;

  const meta = await discover(mcpUrl);
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Shot Studio",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`client registration failed: ${res.status} ${await res.text()}`);
  }
  const { client_id } = (await res.json()) as { client_id: string };
  await putSecret(cacheKey, { clientId: client_id, redirectUri });
  return client_id;
}

// --- token endpoint ---------------------------------------------------------

async function tokenRequest(
  mcpUrl: string,
  body: Record<string, string>,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const meta = await discover(mcpUrl);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
  };
}

// --- public API -------------------------------------------------------------

/** Build the authorize URL + the flow state carried to {@link completeLogin}. */
export async function startLogin(
  mcpUrl: string,
  callbackUrl: string,
): Promise<{ url: string; state: StartState }> {
  const meta = await discover(mcpUrl);
  const clientId = await getClientId(mcpUrl, callbackUrl);
  const verifier = randomB64url(32);
  const challenge = await pkceChallenge(verifier);
  const state = randomB64url(16);

  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", callbackUrl);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");

  return { url: u.toString(), state: { verifier, state, clientId, redirectUri: callbackUrl } };
}

/** Exchange the authorization code for tokens and persist them. */
export async function completeLogin(
  mcpUrl: string,
  principalKey: string,
  s: StartState,
  code: string,
): Promise<{ token: string; expiresAt?: number }> {
  const tok = await tokenRequest(mcpUrl, {
    grant_type: "authorization_code",
    code,
    redirect_uri: s.redirectUri,
    client_id: s.clientId,
    code_verifier: s.verifier,
  });
  const stored: Stored = {
    clientId: s.clientId,
    redirectUri: s.redirectUri,
    accessToken: tok.accessToken,
    refreshToken: tok.refreshToken,
    expiresAt: tok.expiresAt,
  };
  await putSecret(`higgsfield:token:${principalKey}`, stored);
  return { token: tok.accessToken, expiresAt: tok.expiresAt };
}

/**
 * Return a currently-valid bearer for the principal, refreshing if the access
 * token is expired. Returns null when there is no usable credential — the
 * caller then triggers a fresh interactive login.
 */
export async function currentToken(
  mcpUrl: string,
  principalKey: string,
): Promise<{ token: string; expiresAt?: number } | null> {
  const rec = await getSecret<Stored>(`higgsfield:token:${principalKey}`);
  if (!rec) return null;

  const skew = 60_000;
  if (rec.accessToken && rec.expiresAt && rec.expiresAt - skew > Date.now()) {
    return { token: rec.accessToken, expiresAt: rec.expiresAt };
  }

  if (rec.refreshToken) {
    try {
      const tok = await tokenRequest(mcpUrl, {
        grant_type: "refresh_token",
        refresh_token: rec.refreshToken,
        client_id: rec.clientId,
      });
      const merged: Stored = {
        ...rec,
        accessToken: tok.accessToken,
        refreshToken: tok.refreshToken ?? rec.refreshToken,
        expiresAt: tok.expiresAt,
      };
      await putSecret(`higgsfield:token:${principalKey}`, merged);
      return { token: tok.accessToken, expiresAt: tok.expiresAt };
    } catch {
      return null; // refresh failed → re-authorize
    }
  }

  return null;
}
