// GET /api/auto/status — can a new Auto Film start right now?
//
// { ok, reason, paused, keys: { FAL_KEY, DAYTONA_API_KEY, GROQ_API_KEY } }.
// `keys` is presence only (booleans), never a value — it doubles as the health
// check that the platform secrets are set. Behind the ownership middleware like
// every /api route (any signed-in caller; it reads no project state).
import { autoAvailable } from "../lib/auto-availability.js";

export function registerAuto(app) {
  app.get("/api/auto/status", async (c) => {
    const { ok, reason, paused, keys } = await autoAvailable(c.env);
    return c.json({ ok, reason, paused, keys });
  });
}
