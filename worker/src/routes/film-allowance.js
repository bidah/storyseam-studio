// GET /api/auto/allowance — the signed-in user's Film allowance this month.
//
// { ok, limit, used, remaining, resetsAt, period, message? }
//
// Per-USER, not per-project: the ownership middleware in index.js has already
// resolved the caller (session cookie or the agent's signed assertion) and
// 401s an anonymous one, so this reads `userId` and nothing else. The limit is
// creator-set by direct database update (see migrations/003-film-allowance.sql);
// there is deliberately no write route.
import { checkAllowance } from "../lib/film-allowance.js";

export function registerFilmAllowance(app) {
  app.get("/api/auto/allowance", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    return c.json(await checkAllowance(c.env, userId));
  });
}
