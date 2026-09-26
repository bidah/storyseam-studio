// A Film by id — GET /api/auto/films/:id and the bounded history behind it
// (worker/src/lib/film-history.js). The FilmJobs DO only ever held the CURRENT
// job; an ended Film is now archived under its own key so /director-story/
// create/:filmId still lands on it after the next Film replaces it.
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  MAX_HISTORY,
  archiveFilm,
  findLiveFilm,
  historyKey,
  readFilm,
  saveJob,
} from "../../worker/src/lib/film-history.js";
import { registerAuto } from "../../worker/src/routes/auto.js";

// The slice of DurableObjectStorage the helpers use.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    async get(k) { return m.get(k); },
    async put(k, v) {
      if (typeof k === "object") for (const [kk, vv] of Object.entries(k)) m.set(kk, structuredClone(vv));
      else m.set(k, structuredClone(v));
    },
    async delete(k) { for (const kk of [].concat(k)) m.delete(kk); },
  };
}

const job = (id, status = "running", over = {}) => ({
  id,
  prompt: `prompt ${id}`,
  status,
  userId: "u1",
  projectId: "p1",
  steps: [{ key: "world", label: "Idea + World", status: "done" }],
  spend: {},
  ...over,
});

describe("archiveFilm", () => {
  it("ignores a job that is still active", () => {
    expect(archiveFilm([], job("a", "running")).entry).toBeNull();
    expect(archiveFilm([], job("a", "awaiting-confirm")).entry).toBeNull();
  });

  it("puts an ended job first, without its userId, and caps the index", () => {
    const index = Array.from({ length: MAX_HISTORY }, (_, i) => `old${i}`);
    const res = archiveFilm(index, job("new", "done", { film: { url: "/files/f.mp4" } }));
    expect(res.index[0]).toBe("new");
    expect(res.index).toHaveLength(MAX_HISTORY);
    expect(res.evicted).toEqual([`old${MAX_HISTORY - 1}`]);
    expect(res.entry).not.toHaveProperty("userId");
    expect(res.entry.film.url).toBe("/files/f.mp4");
  });

  it("re-archiving the same id moves it rather than duplicating it", () => {
    const res = archiveFilm(["b", "a"], job("a", "stopped"));
    expect(res.index).toEqual(["a", "b"]);
  });
});

describe("findLiveFilm", () => {
  it("finds the current job and a queued one (as status queued + position)", () => {
    const queue = [
      { id: "q1", prompt: "one", userId: "u1", projectId: "p1", queuedAt: "2026-09-26T00:00:00.000Z" },
      { id: "q2", prompt: "two", userId: "u1", projectId: "p1", queuedAt: "2026-09-26T00:01:00.000Z" },
    ];
    expect(findLiveFilm({ job: job("a"), queue }, "a")).toMatchObject({ id: "a", status: "running" });
    const q = findLiveFilm({ job: job("a"), queue }, "q2");
    expect(q).toMatchObject({ id: "q2", status: "queued", position: 2, prompt: "two", steps: [] });
    expect(q).not.toHaveProperty("userId");
    expect(findLiveFilm({ job: job("a"), queue }, "nope")).toBeNull();
  });
});

describe("saveJob / readFilm", () => {
  it("keeps an ended Film readable after the next one replaces it", async () => {
    const s = fakeStorage();
    await saveJob(s, job("a", "running"));
    expect(s.map.get("history")).toBeUndefined(); // nothing ended yet
    await saveJob(s, job("a", "done", { film: { url: "/files/a.mp4" } }));
    await saveJob(s, job("b", "running"));

    expect(await readFilm(s, "b")).toMatchObject({ id: "b", status: "running" });
    const a = await readFilm(s, "a");
    expect(a).toMatchObject({ id: "a", status: "done", film: { url: "/files/a.mp4" } });
    expect(a).not.toHaveProperty("userId");
    expect(await readFilm(s, "zzz")).toBeNull();
  });

  it("archives a job that ended BEFORE the history existed when it is replaced", async () => {
    const s = fakeStorage({ job: job("legacy", "stopped") });
    await saveJob(s, job("next", "running"));
    expect(await readFilm(s, "legacy")).toMatchObject({ id: "legacy", status: "stopped" });
  });

  it("archives refused and declined Films too", async () => {
    const s = fakeStorage();
    await saveJob(s, job("r", "refused", { error: "allowance" }));
    await saveJob(s, job("d", "declined"));
    expect(s.map.get("history")).toEqual(["d", "r"]);
  });

  it("evicts the oldest past MAX_HISTORY and deletes its key", async () => {
    const s = fakeStorage();
    for (let i = 0; i < MAX_HISTORY + 2; i++) await saveJob(s, job(`f${i}`, "done"));
    expect(s.map.get("history")).toHaveLength(MAX_HISTORY);
    expect(s.map.has(historyKey("f0"))).toBe(false);
    expect(s.map.has(historyKey("f1"))).toBe(false);
    expect(await readFilm(s, "f2")).toMatchObject({ id: "f2" });
    expect(await readFilm(s, "f0")).toBeNull();
  });
});

describe("GET /api/auto/films/:id", () => {
  // One fake DO per project, like idFromName(projectId).
  const envWith = (byProject) => ({
    FILM_JOBS: {
      idFromName: (name) => name,
      get: (name) => {
        const storage = byProject[name] || fakeStorage();
        return {
          film: (id) => readFilm(storage, id),
          current: async () => null,
          queued: async () => [],
        };
      },
    },
  });
  const appFor = (env, projectId = "p1") => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("userId", "u1");
      c.set("projectId", projectId);
      await next();
    });
    registerAuto(app);
    return (path) => app.request(path, {}, env);
  };

  it("returns the running, queued and finished Film by id", async () => {
    const s = fakeStorage();
    await saveJob(s, job("done1", "done", { film: { url: "/files/d.mp4" } }));
    await saveJob(s, job("run1", "running"));
    await s.put("queue", [{ id: "q1", prompt: "later", userId: "u1", projectId: "p1", queuedAt: "t" }]);
    const get = appFor(envWith({ p1: s }));

    const run = await get("/api/auto/films/run1");
    expect(run.status).toBe(200);
    expect((await run.json()).job).toMatchObject({ id: "run1", status: "running" });

    expect((await (await get("/api/auto/films/q1")).json()).job).toMatchObject({ status: "queued", position: 1 });

    const done = await (await get("/api/auto/films/done1")).json();
    expect(done.job).toMatchObject({ status: "done", film: { url: "/files/d.mp4" } });
    expect(done.job).not.toHaveProperty("userId");
  });

  it("404s an unknown id, and another project's id", async () => {
    const p1 = fakeStorage();
    await saveJob(p1, job("mine", "done"));
    const env = envWith({ p1 });
    const miss = await appFor(env)("/api/auto/films/nope");
    expect(miss.status).toBe(404);
    expect(await miss.json()).toMatchObject({ ok: false, code: "not-found" });
    expect((await appFor(env, "p2")("/api/auto/films/mine")).status).toBe(404);
  });

  it("leaves /current to its own handler", async () => {
    const res = await appFor(envWith({}))("/api/auto/films/current");
    expect(await res.json()).toEqual({ job: null, queue: [] });
  });
});
