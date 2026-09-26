// Auto — prompt to Film (CONTEXT.md › Auto).
//
//   GET  /api/auto/status         can a new Auto Film start right now?
//                                 { ok, reason, paused, keys: { FAL_KEY, … } }
//   POST /api/auto/films          start a Film on this project. Body { prompt }.
//                                 202 { ok, job } | 4xx/503 { ok:false, refusal:{code,message}, job }
//   GET  /api/auto/films/current  the project's current Film job (for a reload) { job }
//
// `keys` is presence only (booleans), never a value. All behind the ownership
// middleware like every /api route: the caller is signed in and may reach the
// project. The job itself lives in the FilmJobs Durable Object (film-job-do.js)
// — one per project — and runs server-side; see lib/film-job.js.
import { autoAvailable } from "../lib/auto-availability.js";
import { normalizeProjectId } from "../lib/docs.js";
import { MAX_PROMPT_CHARS } from "../lib/film-job.js";

const REFUSAL_STATUS = { invalid: 400, busy: 409, allowance: 429, paused: 503, unavailable: 503 };

const filmJobs = (c) =>
  c.env.FILM_JOBS.get(c.env.FILM_JOBS.idFromName(normalizeProjectId(c.get("projectId"))));

export function registerAuto(app) {
  app.get("/api/auto/status", async (c) => {
    const { ok, reason, paused, keys } = await autoAvailable(c.env);
    return c.json({ ok, reason, paused, keys });
  });

  app.post("/api/auto/films", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS + 1) : "";
    const res = await filmJobs(c).start({
      prompt,
      userId,
      projectId: c.get("projectId"),
      episodeId: c.get("episodeId") || null,
    });
    if (!res.ok) return c.json(res, REFUSAL_STATUS[res.refusal?.code] || 400);
    return c.json(res, 202);
  });

  app.get("/api/auto/films/current", async (c) => {
    return c.json({ job: await filmJobs(c).current() });
  });
}
