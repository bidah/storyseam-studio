// Higgsfield MCP access from the Worker — used by /api/higgsfield/* to browse
// the signed-in user's past generations ("Import from Higgsfield" in the asset
// library).
//
// Auth: "Sign in with Higgsfield" (Better Auth genericOAuth, see src/auth.js)
// stores the user's OAuth bearer on the `account` row (providerId "higgsfield").
// That token is scoped to the same MCP server the render skills use, so the
// Worker can call MCP tools directly with it. When the access token is expired
// we refresh it against the OAuth token endpoint (public client — PKCE, no
// secret) and persist the rotation back onto the account row. A pre-provisioned
// HIGGSFIELD_MCP_TOKEN env is the service-token fallback.
//
// Transport: MCP Streamable HTTP. Workers are stateless, so every tool call is
// a fresh initialize → notifications/initialized → tools/call exchange; the
// response body may be JSON or a one-shot SSE stream (both handled).

const DEFAULT_MCP_URL = "https://mcp.higgsfield.ai/mcp";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";

const mcpUrl = (env) => env.HIGGSFIELD_MCP_URL || DEFAULT_MCP_URL;

// Thrown when the user's Higgsfield credential is missing/expired beyond
// refresh — the route maps this to a 401 so the UI can prompt a re-sign-in.
export class HiggsfieldAuthError extends Error {}

// `accessTokenExpiresAt` comes back from D1 as whatever Better Auth stored
// (ISO string or epoch). Treat "can't tell" as not-expired and let the MCP's
// own 401 be the arbiter.
function isExpired(v) {
  if (v == null || v === "") return false;
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(t)) return false;
  return Date.now() > t - 60_000; // refresh a minute early
}

async function refreshToken(env, row) {
  if (!row.refreshToken) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: row.refreshToken,
        client_id: env.HIGGSFIELD_CLIENT_ID || "",
      }),
    });
    if (!res.ok) return null;
    const tok = await res.json();
    if (!tok.access_token) return null;
    const expiresAt = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
      : null;
    await env.DB.prepare(
      "UPDATE account SET accessToken = ?, refreshToken = COALESCE(?, refreshToken), " +
        "accessTokenExpiresAt = ?, updatedAt = ? WHERE id = ?",
    )
      .bind(tok.access_token, tok.refresh_token || null, expiresAt, new Date().toISOString(), row.id)
      .run();
    return tok.access_token;
  } catch {
    return null;
  }
}

async function accountRow(env, userId) {
  return env.DB.prepare(
    "SELECT id, accessToken, refreshToken, accessTokenExpiresAt FROM account " +
      "WHERE userId = ? AND providerId = 'higgsfield'",
  )
    .bind(userId)
    .first();
}

// The user's live Higgsfield bearer (refreshed if needed), else the static
// service token, else null.
export async function getHiggsfieldToken(env, userId) {
  if (userId) {
    const row = await accountRow(env, userId);
    if (row?.accessToken) {
      if (!isExpired(row.accessTokenExpiresAt)) return row.accessToken;
      const fresh = await refreshToken(env, row);
      if (fresh) return fresh;
    }
  }
  return env.HIGGSFIELD_MCP_TOKEN || null;
}

// Unconditional refresh. The MCP answers an EXPIRED bearer with a generic tool
// error, not a 401 (verified), so when a call fails and the stored expiry
// didn't predict it, the route retries once with this.
export async function forceRefreshHiggsfieldToken(env, userId) {
  if (!userId) return null;
  const row = await accountRow(env, userId);
  if (!row?.refreshToken) return null;
  return refreshToken(env, row);
}

async function rpcPost(env, token, sessionId, body) {
  return fetch(mcpUrl(env), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Extract the JSON-RPC response from either a plain-JSON or SSE reply.
async function parseRpc(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    let msg = null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j && (j.result !== undefined || j.error)) msg = j;
      } catch { /* keep-alives / partial lines */ }
    }
    return msg;
  }
  if (res.status === 202) return null; // accepted notification, no body
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// One-shot MCP tool call. Returns the tool's structured result (Higgsfield's
// tools return JSON, either as structuredContent or as a JSON text block).
export async function mcpToolCall(env, token, name, args) {
  const init = await rpcPost(env, token, null, {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "shot-studio-worker", version: "1.0.0" },
    },
  });
  if (init.status === 401 || init.status === 403) throw new HiggsfieldAuthError("Higgsfield sign-in expired");
  if (!init.ok) throw new Error(`Higgsfield MCP initialize failed (${init.status})`);
  const sessionId = init.headers.get("mcp-session-id");
  await parseRpc(init); // drain the initialize result

  // Spec-required before requests; tolerate servers that reject it.
  try {
    await rpcPost(env, token, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  } catch { /* optional */ }

  const res = await rpcPost(env, token, sessionId, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args || {} },
  });
  if (res.status === 401 || res.status === 403) throw new HiggsfieldAuthError("Higgsfield sign-in expired");
  if (!res.ok) throw new Error(`Higgsfield MCP call failed (${res.status})`);
  const msg = await parseRpc(res);
  if (!msg) throw new Error("Empty Higgsfield MCP response");
  if (msg.error) throw new Error(msg.error.message || "Higgsfield MCP error");
  const r = msg.result || {};
  if (r.isError) {
    const t = (r.content || []).map((p) => p.text || "").join(" ").trim();
    throw new Error(t || "Higgsfield tool error");
  }
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = (r.content || []).find((p) => p.type === "text")?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
