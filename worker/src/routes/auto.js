// Auto — prompt to Film (CONTEXT.md › Auto).
//
//   GET  /api/auto/status         can a new Auto Film start right now?
//                                 { ok, reason, paused, keys: { FAL_KEY, … },
//                                   writers: [{ id, label, blurb }] }  (the model picker)
//   POST /api/auto/films          start a Film IN A NEW PROJECT OF ITS OWN
//                                 (lib/films.js — named "Story — <first words>",
//                                 renamed to the World's title once it has one).
//                                 USER-scoped: it never reads the request's
//                                 project. Body { prompt, seconds?, style?, engine?, writer?, resolution?, score?, depth?, specialists? }.
//                                 `writer` is the LLM that writes it: absent /
//                                 "qwen" = Qwen 3.8 on Workers AI, "kimi" = Kimi
//                                 K2.6 on Workers AI, "claude" = Claude Fable 5.1
//                                 ("default" = the legacy AUTO_WRITER).
//                                 `engine` picks the pipeline: absent = the
//                                 Director, "seedance" = the story flow on
//                                 Seedance 2.5, "h3" = the same on MiniMax H3.
//                                 `score: false` skips the Score stage (every
//                                 engine ends scored otherwise).
//                                 `voices` ("video" | "seedaudio" | "elevenlabs")
//                                 runs a story engine's Voices stage after its
//                                 sheets — every character auditioned once, the
//                                 take referenced by every segment (film-plan.ts
//                                 › Voices). Absent = no stage; the Director
//                                 ignores it.
//                                 `seconds` is a chosen length, one of the
//                                 engine's steps (Director 120 … 300 in 30s;
//                                 story flow 60, then 120 … 300); it wins over a
//                                 length the prompt states. Any other value is a 400.
//                                 202 { ok, job, projectId }          started now
//                                 4xx/503 { ok:false, refusal:{code,message}, job }
//                                 — `busy` (409) while the user's previous Film is
//                                 still being made: one Film at a time per USER.
//                                 Nothing (no project) is created on a refusal.
//   GET  /api/auto/films/latest   USER-scoped: the user's latest Film
//                                 { filmId, projectId, job } | { job: null }
//   GET  /api/auto/films/:id/project  USER-scoped: which project a Film runs in
//                                 200 { projectId } | 404 — only the user's own.
//   GET  /api/auto/films/current  the project's current Film job and the Films
//                                 waiting behind it (for a reload) { job, queue }
//   GET  /api/auto/films/:id      one Film by id: the running job, a queued one
//                                 (status "queued" + position) or an ended one
//                                 from the project's bounded history (the last
//                                 50 — lib/film-history.js). Same shape as
//                                 `current`'s job. 200 { job, projectId } | 404
//                                 { ok:false, code:"not-found" }. The Film's
//                                 project comes from the films lookup (the
//                                 user's own Films); a Film older than the
//                                 lookup is read from the request's project.
//   POST /api/auto/films/:id/confirm  answer the one confirm card an Auto-off
//   POST /api/auto/films/:id/decline  job asks after the World (#65).
//                                 200 { ok, job } | 404/409 { ok:false, code, job }
//   POST /api/auto/films/:id/retry    re-run a STOPPED Film from the step that
//                                 stopped it, keeping every earlier step's
//                                 result and spend (its Series is repaired
//                                 first). Only the project's latest Film, and
//                                 only with nothing running or queued — it
//                                 REFUSES rather than queues.
//                                 202 { ok, job, repaired }
//                                 404 not-found | 409 not-latest|busy|not-stopped
//                                 | 429 allowance | 503 paused|unavailable
//                                 → { ok:false, code, message, job }
//   GET  /api/auto/settings       the signed-in user's Auto toggle { auto }
//   PUT  /api/auto/settings       body { auto: boolean } → { auto }
//                                 Per USER, not per project (lib/auto-settings.js).
//
// `keys` is presence only (booleans), never a value. The project-scoped routes
// sit behind the ownership middleware like every /api route. The three
// USER-scoped ones (start, latest, :id/project) are exempted from project
// scoping in index.js (isUserScopedAuto) because they name no project — or make
// one — and each refuses a request with no signed-in user itself (401): fail
// closed. The job itself lives in the FilmJobs Durable Object (film-job-do.js)
// — one per project — and runs server-side; see lib/film-job.js.
import { autoAvailable } from "../lib/auto-availability.js";
import { MAX_PROMPT_CHARS, checkFilmDepth, checkFilmEngine, checkFilmScore, checkFilmSeconds, checkFilmSpecialists, checkFilmStyle, checkFilmVoices, checkFilmWriter, checkFilmResolution } from "../lib/film-job.js";
import { FILM_WRITERS } from "../lib/film-plan.ts";
import { readAutoSettings, writeAutoSettings } from "../lib/auto-settings.js";
import { checkAllowance } from "../lib/film-allowance.js";
import { activeFilm, filmJobsFor, filmProject, latestFilm, listFilms, recordFilm, storyProjectName } from "../lib/films.js";
import { archiveProject, createProject } from "./projects.js";
import { filmShareToken, shareFilm, unshareFilm } from "../lib/film-share.js";
import { readDoc } from "../lib/docs.js";
import { finishRoom, recordRoomPass, rewriteRound, roomDocName } from "../lib/film-stages/room.js";
import { finishScript, runScriptPass, scriptDocName } from "../lib/film-stages/script-flow.js";

const REFUSAL_STATUS = { invalid: 400, busy: 409, allowance: 429, paused: 503, unavailable: 503 };

const filmJobs = (c) => filmJobsFor(c.env, c.get("projectId"));

const BUSY_MESSAGE = "A story is already being made — wait for it to finish, then start the next one.";

// The DO holding Film `id`: its own project when the films lookup knows it (a
// Film of this user's), else the request's project (a Film started before
// every Film had a project of its own). → { stub, projectId }
async function filmHome(c, id) {
  const own = await filmProject(c.env, id, c.get("userId"));
  const projectId = own || c.get("projectId");
  return { stub: filmJobsFor(c.env, projectId), projectId: projectId ?? null };
}

const refusal = (code, message) => ({ ok: false, refusal: { code, message }, job: null });

export function registerAuto(app) {
  app.get("/api/auto/status", async (c) => {
    const { ok, reason, paused, keys } = await autoAvailable(c.env);
    // The writers the prompt's model picker offers (film-plan.ts FILM_WRITERS).
    return c.json({ ok, reason, paused, keys, writers: FILM_WRITERS });
  });

  // Start a Film — in a project of its own. The checks that can refuse run
  // BEFORE the project is made, so a refusal leaves nothing behind; the DO runs
  // them again (it is the one that must never start a refused Film), and a
  // refusal there archives the project that was made for it.
  app.post("/api/auto/films", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS + 1) : "";
    // The pipeline: the route the author is on chose it (/story-flow sends
    // "seedance"); absent is the Director (/director-story).
    const engine = body?.engine || undefined;
    const badEngine = checkFilmEngine(engine);
    if (badEngine) return c.json(refusal("invalid", badEngine), 400);
    const seconds = body?.seconds ?? undefined;
    const badLength = checkFilmSeconds(seconds, engine);
    if (badLength) return c.json(refusal("invalid", badLength), 400);
    const style = body?.style || undefined;
    const badStyle = checkFilmStyle(style);
    if (badStyle) return c.json(refusal("invalid", badStyle), 400);
    // The LLM that writes it (film-plan.ts FILM_WRITERS); absent is Qwen on Workers AI.
    const writer = body?.writer || undefined;
    const badWriter = checkFilmWriter(writer);
    if (badWriter) return c.json(refusal("invalid", badWriter), 400);
    // What the video renders at (film-plan.ts FILM_RESOLUTIONS); absent is 480p.
    const resolution = body?.resolution || undefined;
    const badResolution = checkFilmResolution(resolution);
    if (badResolution) return c.json(refusal("invalid", badResolution), 400);
    // The Score stage (film-plan.ts › The score); absent is on, `false` skips it.
    const score = body?.score === undefined || body?.score === null ? undefined : body.score;
    const badScore = checkFilmScore(score);
    if (badScore) return c.json(refusal("invalid", badScore), 400);
    // The Voices pass (film-plan.ts › Voices); absent is none.
    const voices = body?.voices || undefined;
    const badVoices = checkFilmVoices(voices);
    if (badVoices) return c.json(refusal("invalid", badVoices), 400);
    // How deep the story work goes (film-plan.ts FILM_DEPTHS) and, for a Deep
    // Film, which specialists read the script; absent is fast / the default room.
    const depth = body?.depth || undefined;
    const badDepth = checkFilmDepth(depth);
    if (badDepth) return c.json(refusal("invalid", badDepth), 400);
    const specialists = depth === "deep" && Array.isArray(body?.specialists) ? body.specialists : undefined;
    const badRoom = checkFilmSpecialists(specialists);
    if (badRoom) return c.json(refusal("invalid", badRoom), 400);
    const text = prompt.trim();
    if (!text) return c.json(refusal("invalid", "Write a prompt first."), 400);
    if (text.length > MAX_PROMPT_CHARS) {
      return c.json(refusal("invalid", `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`), 400);
    }

    // One Film at a time per USER (the per-project queue can't see across projects).
    const active = await activeFilm(c.env, userId);
    if (active) {
      return c.json({ ...refusal("busy", BUSY_MESSAGE), job: active.job, filmId: active.filmId, projectId: active.projectId }, 409);
    }

    const avail = await autoAvailable(c.env);
    if (!avail.ok) {
      const code = avail.paused ? "paused" : "unavailable";
      return c.json(refusal(code, avail.reason), REFUSAL_STATUS[code]);
    }
    const allowance = await checkAllowance(c.env, userId);
    if (!allowance.ok) return c.json(refusal("allowance", allowance.message), REFUSAL_STATUS.allowance);

    const made = await createProject(c.env, userId, { name: storyProjectName(text) });
    if (!made.project) return c.json(refusal("unavailable", "Couldn't make a project for the story."), 503);
    const projectId = made.project.id;
    // The live-sync announcement after this write belongs to the NEW project.
    c.set("projectId", projectId);

    const res = await filmJobsFor(c.env, projectId).start({
      prompt: text,
      ...(seconds !== undefined ? { seconds } : {}),
      ...(style ? { style } : {}),
      ...(engine ? { engine } : {}),
      ...(writer ? { writer } : {}),
      ...(resolution ? { resolution } : {}),
      ...(score === false ? { score: false } : {}),
      ...(voices ? { voices } : {}),
      ...(depth ? { depth } : {}),
      ...(specialists ? { specialists } : {}),
      userId,
      projectId,
      episodeId: null,
    });
    if (!res.ok) {
      await archiveProject(c.env, projectId).catch(() => {});
      return c.json(res, REFUSAL_STATUS[res.refusal?.code] || 400);
    }
    const filmId = res.job?.id ?? res.film?.id;
    // A failed record costs the by-URL lookup, not the Film: it is running.
    if (filmId) {
      await recordFilm(c.env, { filmId, projectId, userId }).catch((err) =>
        console.error("films: couldn't record", filmId, err?.message || err));
    }
    return c.json({ ...res, projectId }, 202);
  });

  // USER-scoped: the user's latest Film, wherever it runs.
  app.get("/api/auto/films/latest", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const latest = await latestFilm(c.env, userId);
    if (!latest) return c.json({ job: null });
    const job = await filmJobsFor(c.env, latest.projectId).film(latest.filmId);
    return c.json({ filmId: latest.filmId, projectId: latest.projectId, job: job || null });
  });

  // USER-scoped: the user's Films, newest first — "Latest stories" on
  // /director-story. Each row's status, prompt and finished film come from its
  // own project's job (read in parallel; a job the DO has aged out still lists,
  // with what the table knows).
  app.get("/api/auto/films/mine", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const rows = await listFilms(c.env, userId, { limit: c.req.query("limit") });
    const films = await Promise.all(rows.map(async (row) => {
      const job = await filmJobsFor(c.env, row.projectId).film(row.filmId).catch(() => null);
      const film = job?.status === "done" ? job.film || null : null;
      return {
        ...row,
        title: film?.title
          || (job?.steps || []).find((st) => st.key === "world")?.result?.title
          || (row.title ? row.title.replace(/^Story — /, "") : null),
        prompt: job?.prompt || null,
        status: job?.status || "unknown",
        engine: job?.engine || "director",
        seconds: film?.seconds ?? job?.seconds ?? null,
        url: film?.url || null,
      };
    }));
    return c.json({ films });
  });

  // USER-scoped: which project a Film runs in. Only the user's own Films.
  app.get("/api/auto/films/:id/project", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const projectId = await filmProject(c.env, c.req.param("id"), userId);
    if (!projectId) return c.json({ ok: false, code: "not-found", error: "No such story." }, 404);
    return c.json({ projectId });
  });

  app.get("/api/auto/films/current", async (c) => {
    const stub = filmJobs(c);
    const [job, queue] = await Promise.all([stub.current(), stub.queued()]);
    return c.json({ job, queue });
  });

  // Registered AFTER /current and /latest so those literal paths win over :id.
  app.get("/api/auto/films/:id", async (c) => {
    const id = c.req.param("id");
    const { stub, projectId } = await filmHome(c, id);
    const job = await stub.film(id);
    if (!job) return c.json({ ok: false, code: "not-found", error: "No such Film." }, 404);
    return c.json({ job, projectId });
  });

  // The Deep Film's writers' room, run by the flue worker's WritersRoomWorkflow
  // (flue-agent/src/cloudflare.ts). These four are ITS surface — the Film's
  // room stage started it and only polls the `film-room:<id>` doc — so the
  // workflow reads what is already done, reports each specialist's pass, asks
  // for each round's rewrite (Claude, here, because the budget and the
  // author's locked lines are worker code) and says when it is finished.
  //   GET  /api/auto/films/:id/room          → the room doc
  //   POST /api/auto/films/:id/room/pass     { round, specialist, summary, findings, report }
  //   POST /api/auto/films/:id/room/rewrite  { round } → the saved draft (idempotent)
  //   POST /api/auto/films/:id/room/finish   { status: "done" | "failed", error? }
  const roomJob = async (c) => {
    const id = c.req.param("id");
    const { stub } = await filmHome(c, id);
    const job = await stub.film(id);
    if (!job) return { res: c.json({ ok: false, code: "not-found", error: "No such Film." }, 404) };
    if (job.depth !== "deep") return { res: c.json({ ok: false, code: "not-deep", error: "This Film has no writers' room." }, 409) };
    return { job };
  };
  const roomError = (c, err) => c.json({ ok: false, error: String(err?.message || err) }, err?.status || 500);
  app.get("/api/auto/films/:id/room", async (c) => {
    const { job, res } = await roomJob(c);
    if (res) return res;
    return c.json({ ok: true, room: await readDoc(c.env, job.projectId, roomDocName(job.id), null) });
  });
  app.post("/api/auto/films/:id/room/pass", async (c) => {
    const { job, res } = await roomJob(c);
    if (res) return res;
    try {
      const body = await c.req.json();
      return c.json({ ok: true, pass: await recordRoomPass(c.env, job.projectId, job.id, body || {}) });
    } catch (err) {
      return roomError(c, err);
    }
  });
  app.post("/api/auto/films/:id/room/rewrite", async (c) => {
    const { job, res } = await roomJob(c);
    if (res) return res;
    try {
      const { round } = await c.req.json();
      return c.json({ ok: true, rewrite: await rewriteRound(c.env, job, round) });
    } catch (err) {
      return roomError(c, err);
    }
  });
  app.post("/api/auto/films/:id/room/finish", async (c) => {
    const { job, res } = await roomJob(c);
    if (res) return res;
    const body = await c.req.json().catch(() => ({}));
    return c.json(await finishRoom(c.env, job.projectId, job.id, body || {}));
  });

  // Every Film's Script flow, run by the flue worker's FilmScriptWorkflow
  // (flue-agent/src/cloudflare.ts) — outline, draft, revision, each a pass on
  // the Film's own writer (film-stages/script-flow.js). Like the room's, these
  // are the workflow's surface: the Script stage started it and polls the
  // `film-script:<id>` doc.
  //   GET  /api/auto/films/:id/script          → the flow's doc
  //   POST /api/auto/films/:id/script/pass     { pass } → the pass entry (idempotent)
  //   POST /api/auto/films/:id/script/finish   { status: "done" | "failed", error? }
  const scriptJob = async (c) => {
    const id = c.req.param("id");
    const { stub } = await filmHome(c, id);
    const job = await stub.film(id);
    if (!job) return { res: c.json({ ok: false, code: "not-found", error: "No such Film." }, 404) };
    return { job };
  };
  app.get("/api/auto/films/:id/script", async (c) => {
    const { job, res } = await scriptJob(c);
    if (res) return res;
    return c.json({ ok: true, script: await readDoc(c.env, job.projectId, scriptDocName(job.id), null) });
  });
  app.post("/api/auto/films/:id/script/pass", async (c) => {
    const { job, res } = await scriptJob(c);
    if (res) return res;
    try {
      const { pass } = await c.req.json();
      return c.json({ ok: true, pass: await runScriptPass(c.env, job, pass) });
    } catch (err) {
      return roomError(c, err);
    }
  });
  app.post("/api/auto/films/:id/script/finish", async (c) => {
    const { job, res } = await scriptJob(c);
    if (res) return res;
    const body = await c.req.json().catch(() => ({}));
    return c.json(await finishScript(c.env, job.projectId, job.id, body || {}));
  });

  const ANSWER_STATUS = { "not-found": 404, "not-awaiting": 409 };
  for (const answer of ["confirm", "decline"]) {
    app.post(`/api/auto/films/:id/${answer}`, async (c) => {
      const id = c.req.param("id");
      const res = await (await filmHome(c, id)).stub[answer](id);
      if (!res.ok) return c.json(res, ANSWER_STATUS[res.code] || 400);
      return c.json(res);
    });
  }

  // Retry a stopped Film from the step that stopped it. Refuses (never queues)
  // when it isn't the project's latest Film, isn't stopped, or another Film is
  // running or waiting — see lib/film-job.js retryFilm.
  const RETRY_STATUS = {
    "not-found": 404, "not-latest": 409, busy: 409, "not-stopped": 409, allowance: 429, paused: 503, unavailable: 503,
  };
  app.post("/api/auto/films/:id/retry", async (c) => {
    const id = c.req.param("id");
    const { stub } = await filmHome(c, id);
    // One Film at a time per USER: another of theirs still being made refuses.
    const active = await activeFilm(c.env, c.get("userId"));
    if (active && active.filmId !== id) {
      return c.json({ ok: false, code: "busy", message: BUSY_MESSAGE, job: null }, 409);
    }
    const res = await stub.retry(id);
    if (!res.ok) return c.json(res, RETRY_STATUS[res.code] || 400);
    return c.json(res, 202);
  });

  // A finished Film's public share link (lib/film-share.js): anyone with the
  // link can watch and download it at /watch/<token>, no account needed.
  // Owner-only — the Film is found through the user's own films lookup, so a
  // Film id alone never shares someone else's Film.
  //   GET    → { shared, token, path, steps }
  //   POST   → mint (or the existing one); body `{ steps: boolean }` switches
  //            "include step details" on the link (absent = leave it as is)
  //   DELETE → revoke; every copy of the link then 404s.
  const shareOf = async (c) => {
    const userId = c.get("userId");
    if (!userId) return { res: c.json({ error: "Sign in required" }, 401) };
    const id = c.req.param("id");
    const pid = await filmProject(c.env, id, userId);
    if (!pid) return { res: c.json({ ok: false, code: "not-found", error: "No such story." }, 404) };
    return { id, pid };
  };
  const shared = ({ token, steps } = {}) => ({
    ok: true, shared: !!token, token: token || null, path: token ? `/watch/${token}` : null, steps: !!token && !!steps,
  });
  app.get("/api/auto/films/:id/share", async (c) => {
    const f = await shareOf(c);
    if (f.res) return f.res;
    return c.json(shared(await filmShareToken(c.env, f.pid, f.id)));
  });
  app.post("/api/auto/films/:id/share", async (c) => {
    const f = await shareOf(c);
    if (f.res) return f.res;
    const job = await filmJobsFor(c.env, f.pid).film(f.id).catch(() => null);
    if (job?.status !== "done" || !job.film?.url) {
      return c.json({ ok: false, code: "not-done", error: "Only a finished story can be shared." }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const steps = typeof body?.steps === "boolean" ? body.steps : undefined;
    return c.json(shared(await shareFilm(c.env, f.pid, f.id, { steps })));
  });
  app.delete("/api/auto/films/:id/share", async (c) => {
    const f = await shareOf(c);
    if (f.res) return f.res;
    await unshareFilm(c.env, f.pid, f.id);
    return c.json(shared());
  });

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
