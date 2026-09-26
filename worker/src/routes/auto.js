// Auto — prompt to Film (CONTEXT.md › Auto).
//
//   GET  /api/auto/status         can a new Auto Film start right now?
//                                 { ok, reason, paused, keys: { FAL_KEY, … } }
//   POST /api/auto/films          start a Film on this project. Body { prompt, seconds? }.
//                                 `seconds` is a chosen length, one of the Film's
//                                 30s steps (120 … 300); it wins over a length the
//                                 prompt states. Any other value is a 400.
//                                 202 { ok, job }                     started now
//                                 202 { ok, queued: true, position, film, job }
//                                     queued behind the running Film (one at a
//                                     time per project — lib/film-queue.js)
//                                 4xx/503 { ok:false, refusal:{code,message}, job }
//   GET  /api/auto/films/current  the project's current Film job and the Films
//                                 waiting behind it (for a reload) { job, queue }
//   GET  /api/auto/films/:id      one Film by id: the running job, a queued one
//                                 (status "queued" + position) or an ended one
//                                 from the project's bounded history (the last
//                                 50 — lib/film-history.js). Same shape as
//                                 `current`'s job. 200 { job } | 404 { ok:false,
//                                 code:"not-found" } — a Film id belongs to ONE
//                                 project, so another project's id is a 404.
//   POST /api/auto/films/:id/confirm  answer the one confirm card an Auto-off
//   POST /api/auto/films/:id/decline  job asks after the World (#65).
//                                 200 { ok, job } | 404/409 { ok:false, code, job }
//   GET  /api/auto/settings       the signed-in user's Auto toggle { auto }
//   PUT  /api/auto/settings       body { auto: boolean } → { auto }
//                                 Per USER, not per project (lib/auto-settings.js).
//
// `keys` is presence only (booleans), never a value. All behind the ownership
// middleware like every /api route: the caller is signed in and may reach the
// project. The job itself lives in the FilmJobs Durable Object (film-job-do.js)
// — one per project — and runs server-side; see lib/film-job.js.
import { autoAvailable } from "../lib/auto-availability.js";
import { normalizeProjectId } from "../lib/docs.js";
import { MAX_PROMPT_CHARS, checkFilmSeconds } from "../lib/film-job.js";
import { readAutoSettings, writeAutoSettings } from "../lib/auto-settings.js";

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
    const seconds = body?.seconds ?? undefined;
    const badLength = checkFilmSeconds(seconds);
    if (badLength) return c.json({ ok: false, refusal: { code: "invalid", message: badLength }, job: null }, 400);
    const res = await filmJobs(c).start({
      prompt,
      ...(seconds !== undefined ? { seconds } : {}),
      userId,
      projectId: c.get("projectId"),
      episodeId: c.get("episodeId") || null,
    });
    if (!res.ok) return c.json(res, REFUSAL_STATUS[res.refusal?.code] || 400);
    return c.json(res, 202);
  });

  app.get("/api/auto/films/current", async (c) => {
    const stub = filmJobs(c);
    const [job, queue] = await Promise.all([stub.current(), stub.queued()]);
    return c.json({ job, queue });
  });

  // Registered AFTER /current so that literal path wins over the :id pattern.
  app.get("/api/auto/films/:id", async (c) => {
    const id = c.req.param("id");
    const job = await filmJobs(c).film(id);
    if (!job) return c.json({ ok: false, code: "not-found", error: "No such Film on this project." }, 404);
    return c.json({ job });
  });

  const ANSWER_STATUS = { "not-found": 404, "not-awaiting": 409 };
  for (const answer of ["confirm", "decline"]) {
    app.post(`/api/auto/films/:id/${answer}`, async (c) => {
      const res = await filmJobs(c)[answer](c.req.param("id"));
      if (!res.ok) return c.json(res, ANSWER_STATUS[res.code] || 400);
      return c.json(res);
    });
  }

  app.get("/api/auto/settings", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    return c.json(await readAutoSettings(c.env, userId));
  });

  app.put("/api/auto/settings", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = null; }
    if (typeof body?.auto !== "boolean") return c.json({ error: "Body must be { auto: boolean }" }, 400);
    return c.json(await writeAutoSettings(c.env, userId, { auto: body.auto }));
  });
}
