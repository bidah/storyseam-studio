// The author's own fal key, stored server-side (lib/user-fal-key.js).
//
//   GET    /api/account/fal-key   { connected, last4, updatedAt } — never the key
//   PUT    /api/account/fal-key   { key } → saves it (encrypted)
//   DELETE /api/account/fal-key   forgets it
//
// Per-USER, not per-project (one fal account pays for everything an author
// makes), so `/api/account` is exempt from the project-ownership middleware and
// every route here 401s without a userId itself.
import {
  checkFalKey,
  deleteUserFalKey,
  saveUserFalKey,
  userFalKeyStatus,
} from "../lib/user-fal-key.js";

export function registerFalKey(app) {
  app.get("/api/account/fal-key", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    return c.json(await userFalKeyStatus(c.env, userId));
  });

  app.put("/api/account/fal-key", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const bad = checkFalKey(body?.key);
    if (bad) return c.json({ error: bad }, 400);
    await saveUserFalKey(c.env, userId, body.key);
    return c.json(await userFalKeyStatus(c.env, userId));
  });

  app.delete("/api/account/fal-key", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    await deleteUserFalKey(c.env, userId);
    return c.json(await userFalKeyStatus(c.env, userId));
  });
}
