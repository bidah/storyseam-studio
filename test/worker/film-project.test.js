// A project per Film (worker/src/lib/films.js, routes/auto.js).
//
// The bug this guards: an Auto Film ran inside the author's CURRENT project, and
// the World stage MERGES into that project's World — so a story about two
// friends in the woods came back with sheets for the mecha pilot of the
// author's existing project. Every Film now starts in a new project of its own,
// found again by id through the `films` lookup, one Film at a time per user.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { makeEnv, makeDocsDB } from "./_fakes.js";
import { registerAuto } from "../../worker/src/routes/auto.js";
import { advanceFilm, publicJob } from "../../worker/src/lib/film-job.js";
import { submitFilm } from "../../worker/src/lib/film-queue.js";
import { JOB_KEY, QUEUE_KEY, readFilm, saveJob } from "../../worker/src/lib/film-history.js";
import { nameFilmProject, storyProjectName } from "../../worker/src/lib/films.js";
import { saveWorld, readWorld } from "../../worker/src/routes/world.js";

const SCHEMA = readFileSync(new URL("../../worker/schema.sql", import.meta.url), "utf8");
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };

function fakeStorage() {
  const m = new Map();
  return {
    async get(k) { return m.get(k); },
    async put(k, v) {
      if (typeof k === "object") for (const [kk, vv] of Object.entries(k)) m.set(kk, structuredClone(vv));
      else m.set(k, structuredClone(v));
    },
    async delete(k) { for (const kk of [].concat(k)) m.delete(kk); },
  };
}

// The FilmJobs DO's start/film, over the same pure functions it calls (the real
// class imports `cloudflare:workers`). `advance` runs one stage like its alarm.
function fakeFilmJobs(envRef) {
  const dos = new Map();
  const make = () => {
    const storage = fakeStorage();
    return {
      storage,
      async start(input) {
        const job = await storage.get(JOB_KEY);
        const queue = (await storage.get(QUEUE_KEY)) || [];
        const res = await submitFilm({ job, queue }, input, { env: envRef.env });
        if (!res.ok) return { ...res, job: publicJob(job) };
        if (res.queued) throw new Error("a fresh project's DO must never queue");
        await saveJob(storage, res.job);
        return { ok: true, job: publicJob(res.job) };
      },
      film: (id) => readFilm(storage, id),
      async advance(model) {
        const job = await storage.get(JOB_KEY);
        return advanceFilm(job, { env: envRef.env, model, saveWorld, commit: (j) => saveJob(storage, j) });
      },
      async end(status = "done") {
        await saveJob(storage, { ...(await storage.get(JOB_KEY)), status });
      },
    };
  };
  return {
    dos,
    idFromName: (n) => n,
    get: (n) => {
      if (!dos.has(n)) dos.set(n, make());
      return dos.get(n);
    },
  };
}

function setup() {
  const envRef = {};
  const FILM_JOBS = fakeFilmJobs(envRef);
  const env = { ...makeEnv({ DB: makeDocsDB(SCHEMA) }), ...KEYS, FILM_JOBS };
  envRef.env = env;
  const app = new Hono();
  // Stand-in for index.js: the identity middleware (a test header here) and
  // the request's project — which the user-scoped routes must never use.
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    if (user) c.set("userId", user);
    c.set("projectId", c.req.header("x-project-id") || null);
    await next();
  });
  registerAuto(app);
  const call = (path, { user = "u1", method = "GET", body, project } = {}) =>
    app.request(
      path,
      {
        method,
        headers: {
          ...(user ? { "x-user": user } : {}),
          ...(project ? { "x-project-id": project } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    );
  const start = (prompt, opts = {}) => call("/api/auto/films", { method: "POST", body: { prompt }, ...opts });
  const projects = () => env.DB._db.prepare("SELECT id, name, owner_user_id, archived FROM projects ORDER BY created_at").all();
  return { env, call, start, projects, FILM_JOBS };
}

const worldAnswer = (title, names) => ({
  idea: `${title}, as a short film.`,
  world: {
    title,
    logline: `${title} logline`,
    map: { world: "somewhere" },
    depth: {},
    characters: names.map((name) => ({ name, role: "lead", appearance: `${name} look` })),
    locations: [{ name: "A place", description: "light" }],
  },
});
const model = (answer) => ({ json: vi.fn(async () => answer) });

describe("a project per Film", () => {
  it("two Films land in two NEW projects with separate Worlds — the second has none of the first's (or the current project's) characters", async () => {
    const { env, start, projects, FILM_JOBS } = setup();
    // The author's existing studio project, with its own World.
    await saveWorld(env, "p_mecha", { title: "Mecha Launch", characters: [{ name: "Kai" }, { name: "Commander" }] });

    const r1 = await start("A mecha pilot launches at dawn", { project: "p_mecha" });
    expect(r1.status).toBe(202);
    const a = await r1.json();
    expect(a.projectId).toMatch(/^p_/);
    expect(a.projectId).not.toBe("p_mecha");
    await FILM_JOBS.get(a.projectId).advance(model(worldAnswer("Sky Forge", ["Rin", "Old Tomo"])));
    await FILM_JOBS.get(a.projectId).end("done");

    const r2 = await start("Two friends lost in the woods", { project: "p_mecha" });
    expect(r2.status).toBe(202);
    const b = await r2.json();
    expect(b.projectId).not.toBe(a.projectId);
    expect(b.projectId).not.toBe("p_mecha");
    await FILM_JOBS.get(b.projectId).advance(model(worldAnswer("The Boundary Stone", ["Sara", "Helena"])));

    const w1 = await readWorld(env, a.projectId);
    const w2 = await readWorld(env, b.projectId);
    expect(w1.characters.map((c) => c.name)).toEqual(["Rin", "Old Tomo"]);
    expect(w2.characters.map((c) => c.name)).toEqual(["Sara", "Helena"]);
    // The author's current project was never touched.
    expect((await readWorld(env, "p_mecha")).characters.map((c) => c.name)).toEqual(["Kai", "Commander"]);

    const rows = projects();
    const own = rows.filter((p) => p.id === a.projectId || p.id === b.projectId);
    expect(own).toHaveLength(2);
    expect(own.every((p) => p.owner_user_id === "u1" && p.archived === 0)).toBe(true);
    expect(own.map((p) => p.name)).toEqual([
      "Story — A mecha pilot launches at dawn",
      "Story — Two friends lost in the woods",
    ]);
  });

  it("names the project from the prompt, then after the World's title — only a Film's own project", async () => {
    expect(storyProjectName("  a   robot  ")).toBe("Story — a robot");
    expect(storyProjectName("one two three four five six seven")).toBe("Story — one two three four five six…");
    expect(storyProjectName("")).toBe("Story");

    const { env, start, projects } = setup();
    const { job, projectId } = await (await start("a robot")).json();
    await nameFilmProject(env, job.id, "Tin Heart");
    await nameFilmProject(env, "film-unknown", "Nope");
    expect(projects().find((p) => p.id === projectId).name).toBe("Story — Tin Heart");
  });
});

describe("GET /api/auto/films/:id/project — the lookup", () => {
  it("answers the owner, 404s anyone else, 401s no one", async () => {
    const { start, call } = setup();
    const { job, projectId } = await (await start("a robot")).json();
    const path = `/api/auto/films/${job.id}/project`;

    const mine = await call(path);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ projectId });

    expect((await call(path, { user: "u2" })).status).toBe(404);
    expect((await call("/api/auto/films/film-nope/project")).status).toBe(404);
    expect((await call(path, { user: null })).status).toBe(401);
  });

  it("reads a Film by id in ITS project whatever project the request names — and not for another user", async () => {
    const { start, call } = setup();
    const { job, projectId } = await (await start("a robot")).json();

    const res = await call(`/api/auto/films/${job.id}`, { project: "p_elsewhere" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ projectId, job: { id: job.id, status: "running" } });
    expect(body.job.userId).toBeUndefined();

    expect((await call(`/api/auto/films/${job.id}`, { user: "u2", project: "p_theirs" })).status).toBe(404);
  });

  it("GET /api/auto/films/latest is the user's own latest Film", async () => {
    const { start, call, FILM_JOBS } = setup();
    expect(await (await call("/api/auto/films/latest")).json()).toEqual({ job: null });
    const a = await (await start("first")).json();
    await FILM_JOBS.get(a.projectId).end("done");
    const b = await (await start("second")).json();

    const latest = await (await call("/api/auto/films/latest")).json();
    expect(latest).toMatchObject({ filmId: b.job.id, projectId: b.projectId, job: { id: b.job.id } });
    expect(await (await call("/api/auto/films/latest", { user: "u2" })).json()).toEqual({ job: null });
    expect((await call("/api/auto/films/latest", { user: null })).status).toBe(401);
  });
});

describe("one Film at a time per user", () => {
  it("refuses a second Film while the first is being made — and makes no project for it", async () => {
    const { start, projects, FILM_JOBS } = setup();
    const a = await (await start("first")).json();
    const before = projects().length;

    const busy = await start("second");
    expect(busy.status).toBe(409);
    const body = await busy.json();
    expect(body).toMatchObject({ ok: false, refusal: { code: "busy" }, filmId: a.job.id, projectId: a.projectId });
    expect(projects()).toHaveLength(before);

    // Another user is not held up by it.
    expect((await start("theirs", { user: "u2" })).status).toBe(202);

    // Once it ends, the next one starts — in yet another project.
    await FILM_JOBS.get(a.projectId).end("stopped");
    const next = await start("second");
    expect(next.status).toBe(202);
    expect((await next.json()).projectId).not.toBe(a.projectId);
  });

  it("an awaiting-confirm Film holds the user too", async () => {
    const { start, FILM_JOBS } = setup();
    const a = await (await start("first")).json();
    await FILM_JOBS.get(a.projectId).end("awaiting-confirm");
    expect((await start("second")).status).toBe(409);
  });

  it("a refusal before the start (Auto paused) makes no project", async () => {
    const { env, start, projects } = setup();
    env.AUTO_PAUSED = "1";
    const res = await start("a robot");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, refusal: { code: "paused" } });
    expect(projects()).toHaveLength(0);
  });

  it("no signed-in user → 401, nothing made", async () => {
    const { start, projects } = setup();
    expect((await start("a robot", { user: null })).status).toBe(401);
    expect(projects()).toHaveLength(0);
  });
});
