// Auth + secrets endpoints, ported from server/index.js (~2490-2551). The app
// is gated behind a Higgsfield sign-in (the same OAuth the render skills use);
// we're "logged in" when a pre-provisioned static bearer is configured
// (HIGGSFIELD_MCP_TOKEN env), or when the interactive OAuth has stored a token
// for the local principal.
//
// The file-backed `.secrets/` KV store becomes a D1 table
// `secrets(key, value, updated_at)`. Values are opaque JSON (the OAuth token
// record is an object with an `accessToken` field), so they're stored as a
// JSON-encoded TEXT column and parsed back out on read.
//
// Secrets are GLOBAL (the single user's credentials) — never scoped by project.
//
// The OAuth *flow* lives entirely outside the Worker: the eve agent performs the
// Higgsfield sign-in and persists the token by calling PUT /api/secrets/<key>.
// The Worker only needs this KV surface + the derived auth-status read.

const SAFE_SECRET_KEY = /^[A-Za-z0-9._:/-]{1,200}$/;

// NOTE: app LOGIN is now Better Auth (/api/auth/* — see src/auth.js). This file
// only keeps the /api/secrets KV surface the eve agent uses to persist the
// Higgsfield MCP token (used by the render skills, NOT for app login). Secrets
// are GLOBAL (not per-project).
export function registerSecrets(app) {
  // KV store the eve agent uses to persist the Higgsfield OAuth token. The
  // `:key{.+}` pattern captures keys containing slashes (SAFE_SECRET_KEY allows
  // them), matching the Express route's reach.
  app.get("/api/secrets/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (!SAFE_SECRET_KEY.test(key)) return c.json({ error: "bad key" }, 400);
    const row = await c.env.DB.prepare("SELECT value FROM secrets WHERE key = ?").bind(key).first();
    if (!row) return c.json({ error: "not found" }, 404);
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    return c.json({ value });
  });

  app.put("/api/secrets/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (!SAFE_SECRET_KEY.test(key)) return c.json({ error: "bad key" }, 400);
    let body;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const value = body?.value ?? null;
    const updatedAt = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind(key, JSON.stringify(value), updatedAt)
      .run();
    return c.json({ ok: true });
  });

  app.delete("/api/secrets/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (!SAFE_SECRET_KEY.test(key)) return c.json({ error: "bad key" }, 400);
    await c.env.DB.prepare("DELETE FROM secrets WHERE key = ?").bind(key).run();
    return c.json({ ok: true });
  });
}
