// The Film (#71): when the score completes the job turns `done`, carries
// `job.film`, counts the allowance ONCE, registers the Film as a project file
// (the Editor's media pool), and keeps its spend per stage plus a total.
// Runs the real runner against fake stage runners shaped like the real ones.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { makeEnv, makeDocsDB, DOCS_SCHEMA } from "./_fakes.js";
import { advanceFilm, completeFilm, filmOf, runFilm, startFilm } from "../../worker/src/lib/film-job.js";
import { checkAllowance } from "../../worker/src/lib/film-allowance.js";
import { readSittings, updateSittings } from "../../worker/src/lib/director.js";
import { filmsInPool } from "../../worker/src/routes/timeline.js";

const ALLOWANCE_SCHEMA = readFileSync(
  new URL("../../worker/migrations/003-film-allowance.sql", import.meta.url),
  "utf8",
);
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const envWith = () => ({ ...makeEnv({ DB: makeDocsDB(DOCS_SCHEMA + "\n" + ALLOWANCE_SCHEMA) }), ...KEYS });
const PID = "p1";

const stage = (key, result, { spend = 0, fail = 0 } = {}) => {
  let calls = 0;
  return {
    key,
    label: key,
    run: vi.fn(async () => {
      if (calls++ < fail) {
        const err = new Error(`${key} broke`);
        err.spend = spend;
        throw err;
      }
      return { summary: `${key} done`, result, spend };
    }),
  };
};

// The pipeline's shape, with the results the real stages hand on.
const pipeline = () => [
  stage("world", { idea: "A cat relights a lighthouse before the storm.", title: "The Last Lamp" }),
  stage("sheets", { seriesId: "s_1" }, { spend: 0.3 }),
  stage("sitting", { seriesId: "s_1", sittingId: "sit-1", file: "sitting-1.webm", url: "/director-media/sitting-1.webm", seconds: 121 }, { spend: 2.5 }),
  stage("score", {
    seriesId: "s_1",
    sittingId: "sit-1",
    url: "/director-media/sit-1-scored.mp4",
    file: "sit-1-scored.mp4",
    unscored: { file: "sitting-1.webm", url: "/director-media/sitting-1.webm" },
    measured: { durationMs: 120_480 },
  }, { spend: 1.25 }),
];

async function keptSitting(env) {
  await updateSittings(env, PID, (db) => {
    db.kept = [{ id: "sit-1", seriesId: "s_1", file: "sitting-1.webm", scoredFile: "sit-1-scored.mp4", seconds: 121, filmId: "film-1" }];
    return {};
  });
}

async function started(env) {
  const res = await startFilm(null, { prompt: "a cat saves a lighthouse", userId: "u1", projectId: PID }, { env, newId: () => "film-1" });
  expect(res.ok).toBe(true);
  return res.job;
}

const used = async (env) => (await checkAllowance(env, "u1")).used;

describe("the Film — completion", () => {
  it("a full run ends `done` with job.film, counts once, files the Film and emits film.done", async () => {
    const env = envWith();
    await keptSitting(env);
    const events = [];
    const job = await runFilm(await started(env), { env, stages: pipeline(), commit: async (_j, ev) => events.push(ev) });

    expect(job.status).toBe("done");
    expect(job.film).toEqual({
      url: "/director-media/sit-1-scored.mp4",
      file: "sit-1-scored.mp4",
      unscored: { file: "sitting-1.webm", url: "/director-media/sitting-1.webm" },
      seconds: 120.5,
      seriesId: "s_1",
      sittingId: "sit-1",
      title: "The Last Lamp",
      idea: "A cat relights a lighthouse before the storm.",
    });
    // Spend per stage, and the total, stay on the stored job.
    expect(job.spend).toEqual({ sheets: 0.3, sitting: 2.5, score: 1.25 });
    expect(job.spent).toBe(4.05);
    expect(job.allowance).toMatchObject({ counted: true, kind: "new" });
    expect(await used(env)).toBe(1);

    const done = events.at(-1);
    expect(done.kind).toBe("film.done");
    expect(done.job.film.url).toBe("/director-media/sit-1-scored.mp4");
    expect(done.job.spent).toBe(4.05);
    expect(events.filter((e) => e.kind === "film.done")).toHaveLength(1);

    // A project file: the kept row is stamped, and the Editor's pool lists it.
    const row = (await readSittings(env, PID)).kept[0];
    expect(row.film).toMatchObject({ id: "film-1", title: "The Last Lamp" });
    expect(await filmsInPool(env, PID)).toEqual([
      expect.objectContaining({
        id: "pool-film-film-1",
        mediaType: "video",
        name: "Film — The Last Lamp",
        src: "/director-media/sit-1-scored.mp4",
      }),
    ]);
  });

  it("a completion delivered twice (evicted before film.done) counts once", async () => {
    const env = envWith();
    await keptSitting(env);
    const commits = [];
    const deps = { env, stages: pipeline(), commit: async (j, ev) => commits.push([j, ev]) };
    const done = await runFilm(await started(env), deps);
    expect(done.status).toBe("done");

    // The state persisted at the score's step.done — every step done, the job
    // still `running` — is what an evicted DO wakes up to.
    const [beforeDone] = commits.find(([, ev]) => ev.kind === "step.done" && ev.step === "score");
    expect(beforeDone.status).toBe("running");
    const again = await advanceFilm(beforeDone, deps);
    expect(again.status).toBe("done");
    expect(again.allowance).toMatchObject({ counted: false, duplicate: true });
    expect(await used(env)).toBe(1);

    // And a done job advanced again does nothing at all.
    const events = commits.length;
    expect(await advanceFilm(again, deps)).toBe(again);
    expect(commits).toHaveLength(events);
    expect(await used(env)).toBe(1);
  });

  it("a stopped Film never counts and has no film", async () => {
    const env = envWith();
    await keptSitting(env);
    const stages = pipeline();
    stages[3] = stage("score", {}, { fail: 2, spend: 0.1 });
    const job = await runFilm(await started(env), { env, stages, commit: async () => {} });
    expect(job.status).toBe("stopped");
    expect(job.film).toBeUndefined();
    expect(job.stopped.spent).toBeCloseTo(0.3 + 2.5 + 0.2);
    expect(await used(env)).toBe(0);
    expect(await filmsInPool(env, PID)).toEqual([]);
  });

  it("a counting failure does not lose the finished Film", async () => {
    const env = envWith();
    await keptSitting(env);
    const job = await runFilm(await started(env), {
      env,
      stages: pipeline(),
      commit: async () => {},
    });
    const redo = await completeFilm({ ...job, status: "running" }, {
      env,
      countFilm: async () => { throw new Error("D1 down"); },
    });
    expect(redo.status).toBe("done");
    expect(redo.film.url).toBe("/director-media/sit-1-scored.mp4");
    expect(redo.allowance).toMatchObject({ counted: false, error: "D1 down" });
  });

  it("filmOf is null without a scored film (a swapped-out pipeline finishes without one)", () => {
    expect(filmOf({ steps: [{ key: "world", status: "done", result: { title: "x" } }] })).toBeNull();
  });
});
