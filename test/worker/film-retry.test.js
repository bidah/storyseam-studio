// Retry a stopped Film from the step that stopped it (lib/film-job.js
// retryFilm) — and the Series repair that runs first (director.js
// sanitizeSeries / repairSeries). A Film that stopped at Stills must not
// re-buy its World, sheets and clips to get past a later step.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { makeEnv, makeDocsDB, DOCS_SCHEMA } from "./_fakes.js";
import {
  advanceFilm,
  repairFilmSeries,
  retryFilm,
  runFilm,
  startFilm,
  totalSpend,
} from "../../worker/src/lib/film-job.js";
import { submitFilm } from "../../worker/src/lib/film-queue.js";
import { checkAllowance, countFilm } from "../../worker/src/lib/film-allowance.js";
import {
  createSeries,
  patchSeries,
  readSeries,
  repairSeries,
  sanitizeSeries,
  updateSeries,
} from "../../worker/src/lib/director.js";
import { MAX_SHEET_REFS } from "../../worker/src/lib/series.ts";
import { registerAuto } from "../../worker/src/routes/auto.js";

const ALLOWANCE_SCHEMA = readFileSync(
  new URL("../../worker/migrations/003-film-allowance.sql", import.meta.url),
  "utf8",
);
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const envWith = (extra = {}) => ({ ...makeEnv({ DB: makeDocsDB(DOCS_SCHEMA + "\n" + ALLOWANCE_SCHEMA) }), ...KEYS, ...extra });
const ok = async () => ({ ok: true });

// A fake stage: `plan` is one outcome per call — "ok" or { throw }.
function fakeStage(key, { plan = ["ok"], spend = 0 } = {}) {
  let i = 0;
  const run = vi.fn(async ({ attempt, results }) => {
    const o = plan[Math.min(i++, plan.length - 1)];
    if (o !== "ok") throw new Error(o.throw);
    return { summary: `${key} made`, result: { key, attempt, saw: Object.keys(results), seriesId: "s_film" }, spend };
  });
  return { key, label: key[0].toUpperCase() + key.slice(1), run };
}

let seq = 0;
async function started(env) {
  const res = await startFilm(null, { prompt: "a film", userId: "u1", projectId: "p1" }, { env, newId: () => `film-r${++seq}` });
  expect(res.ok).toBe(true);
  return res.job;
}

// world → sheets → run (paid) → stills, where stills fails twice and stops.
function pipeline() {
  const world = fakeStage("world");
  const sheets = fakeStage("sheets", { spend: 0.4 });
  const run = fakeStage("run", { spend: 6 });
  const stills = fakeStage("stills", {
    plan: [{ throw: "The first frame was refused: Too big" }, { throw: "The first frame was refused: Too big" }, "ok"],
    spend: 0.1,
  });
  const score = fakeStage("score", { spend: 0.5 });
  return { world, sheets, run, stills, score, stages: [world, sheets, run, stills, score] };
}

async function stoppedAtStills(env) {
  const p = pipeline();
  const job = await runFilm(await started(env), { env, stages: p.stages });
  expect(job.status).toBe("stopped");
  expect(job.stopped.stage).toBe("stills");
  return { ...p, job };
}

describe("retryFilm", () => {
  it("resumes a Film stopped at stills AT stills, keeping earlier results and spend", async () => {
    const env = envWith();
    const { job, world, sheets, run, stills, stages } = await stoppedAtStills(env);
    const spentBefore = totalSpend(job);
    expect(spentBefore).toBeCloseTo(6.4);
    const earlier = job.steps.slice(0, 3).map((s) => s.result);

    const events = [];
    const repair = vi.fn(async () => ({ seriesId: "s_film", fixes: ["trimmed"] }));
    const res = await retryFilm({ job, queue: [] }, job.id, {
      env, availability: ok, repair, commit: async (_j, ev) => events.push(ev),
    });
    expect(res.ok).toBe(true);
    expect(repair).toHaveBeenCalledOnce();
    expect(events.map((e) => [e.kind, e.step])).toEqual([["film.retried", "stills"]]);

    const retried = res.job;
    expect(retried.status).toBe("running");
    expect(retried.stopped).toBeUndefined();
    expect(retried.error).toBeNull();
    expect(retried.steps.map((s) => [s.key, s.status])).toEqual([
      ["world", "done"], ["sheets", "done"], ["run", "done"], ["stills", "running"],
    ]);
    expect(retried.steps.at(-1)).toMatchObject({ failures: 0, attemptBase: 2, error: null });
    expect(retried.steps.slice(0, 3).map((s) => s.result)).toEqual(earlier);
    expect(totalSpend(retried)).toBeCloseTo(spentBefore);
    expect(retried.retries).toEqual([
      expect.objectContaining({ stage: "stills", reason: "The first frame was refused: Too big", repaired: { seriesId: "s_film", fixes: ["trimmed"] } }),
    ]);

    // The runner picks up AT stills — nothing earlier runs again.
    const calls = [world, sheets, run].map((s) => s.run.mock.calls.length);
    const next = await advanceFilm(retried, { env, stages });
    expect([world, sheets, run].map((s) => s.run.mock.calls.length)).toEqual(calls);
    expect(stills.run).toHaveBeenCalledTimes(3);
    // Its attempt number keeps rising past the two that failed.
    expect(stills.run.mock.calls[2][0].attempt).toBe(3);
    expect(stills.run.mock.calls[2][0].results).toMatchObject({ world: earlier[0], sheets: earlier[1], run: earlier[2] });
    expect(next.steps.at(-1)).toMatchObject({ key: "stills", status: "done" });

    const done = await runFilm(next, { env, stages, countFilm: async () => ({ counted: true, kind: "new" }) });
    expect(done.status).toBe("done");
    expect(totalSpend(done)).toBeCloseTo(spentBefore + 0.1 + 0.5);
  });

  it("gives the retried step a fresh retry-once budget, then stops again", async () => {
    const env = envWith();
    const bad = fakeStage("b", { plan: [{ throw: "no" }] });
    const stages = [fakeStage("a"), bad];
    const job = await runFilm(await started(env), { env, stages });
    const res = await retryFilm({ job }, job.id, { env, availability: ok });
    const again = await runFilm(res.job, { env, stages });
    expect(bad.run).toHaveBeenCalledTimes(4);
    expect(again.status).toBe("stopped");
    expect(again.stopped.stage).toBe("b");
  });

  it("refuses while another Film is running or queued, and never touches it", async () => {
    const env = envWith();
    const { job } = await stoppedAtStills(env);

    // A newer Film is running: the stopped one is only in the history.
    const running = await started(env);
    let res = await retryFilm({ job: running, queue: [], archived: job }, job.id, { env, availability: ok });
    expect(res).toMatchObject({ ok: false, code: "busy" });

    // The stopped Film is still current, but a Film is queued behind it.
    const queued = await submitFilm({ job: running, queue: [] }, { prompt: "next", userId: "u1", projectId: "p1" }, { env });
    expect(queued.queued).toBe(true);
    res = await retryFilm({ job, queue: queued.queue }, job.id, { env, availability: ok });
    expect(res).toMatchObject({ ok: false, code: "busy" });
    expect(job.status).toBe("stopped");
  });

  it("refuses a Film that isn't the latest, isn't stopped, or doesn't exist", async () => {
    const env = envWith();
    const { job } = await stoppedAtStills(env);
    const later = { ...(await started(env)), status: "done" };
    expect(await retryFilm({ job: later, archived: job }, job.id, { env, availability: ok }))
      .toMatchObject({ ok: false, code: "not-latest" });
    expect(await retryFilm({ job: later }, "film-nope", { env, availability: ok }))
      .toMatchObject({ ok: false, code: "not-found" });
    expect(await retryFilm({ job: later }, later.id, { env, availability: ok }))
      .toMatchObject({ ok: false, code: "not-stopped" });
  });

  it("refuses when the kill switch is thrown", async () => {
    const env = envWith();
    const { job } = await stoppedAtStills(env);
    const res = await retryFilm({ job }, job.id, {
      env, availability: async () => ({ ok: false, paused: true, reason: "Auto is paused." }),
    });
    expect(res).toEqual({ ok: false, code: "paused", message: "Auto is paused." });
  });

  it("counts the allowance once: the stopped Film never counted, the finished retry counts once", async () => {
    const env = envWith();
    const { job, stages } = await stoppedAtStills(env);
    expect((await checkAllowance(env, "u1")).used).toBe(0);
    const res = await retryFilm({ job }, job.id, { env, availability: ok });
    const done = await runFilm(res.job, { env, stages });
    expect(done.status).toBe("done");
    expect(done.allowance).toMatchObject({ counted: true, kind: "new" });
    expect((await checkAllowance(env, "u1")).used).toBe(1);
    // A second completion of the same job id is a duplicate, not a second Film.
    expect(await countFilm(env, "u1", { filmId: job.id, kind: "new" })).toMatchObject({ counted: false, duplicate: true });
    expect((await checkAllowance(env, "u1")).used).toBe(1);
  });

  it("refuses when the allowance is used up", async () => {
    const env = envWith();
    const { job } = await stoppedAtStills(env);
    for (let i = 0; i < 10; i++) await countFilm(env, "u1", { filmId: `old-${i}`, kind: "new" });
    const res = await retryFilm({ job }, job.id, { env, availability: ok });
    expect(res).toMatchObject({ ok: false, code: "allowance" });
  });
});

describe("sanitizeSeries", () => {
  const refs = (n) => Array.from({ length: n }, (_, i) => `https://img.test/${i}.png`);

  it("trims every model sheet's refs to MAX_SHEET_REFS", () => {
    const series = {
      id: "s1",
      modelSheets: [
        { kind: "style", name: "look", refs: refs(9) },
        { kind: "character", name: "Mote", refs: refs(3) },
        { kind: "location", name: "Lamp" },
      ],
    };
    const { series: fixed, fixes } = sanitizeSeries(series);
    expect(fixed.modelSheets[0].refs).toEqual(refs(MAX_SHEET_REFS));
    expect(fixed.modelSheets[1].refs).toEqual(refs(3));
    expect(fixed.modelSheets[2]).toBe(series.modelSheets[2]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatch(/look.*9.*8/);
    expect(series.modelSheets[0].refs).toHaveLength(9); // pure
  });

  it("returns the same object when nothing needs fixing", () => {
    const series = { id: "s1", modelSheets: [{ kind: "style", name: "look", refs: refs(8) }] };
    expect(sanitizeSeries(series)).toEqual({ series, fixes: [] });
    expect(sanitizeSeries(series).series).toBe(series);
    expect(sanitizeSeries(null).fixes).toEqual([]);
  });

  it("repairs a stored Series so the write it blocked goes through", async () => {
    const env = makeEnv();
    const made = await createSeries(env, "p1", { title: "Film", prompt: "a cat", aspectRatio: "16:9" }, { filmId: "film-x" });
    const id = made.series.id;
    // An older run filed a style sheet with 9 refs, straight to the row.
    await updateSeries(env, "p1", id, (row) => {
      row.modelSheets = [{ kind: "style", name: "look", refs: refs(9) }];
      return {};
    });
    const blocked = await patchSeries(env, "p1", id, { imageUrl: "https://img.test/first.png" });
    expect(blocked.issues).toBeTruthy();

    const job = { id: "film-x", projectId: "p1", steps: [] }; // found by filmId
    expect(await repairFilmSeries(env, job)).toMatchObject({ seriesId: id, fixes: [expect.stringMatching(/9 refs/)] });
    expect((await readSeries(env, "p1", id)).modelSheets[0].refs).toHaveLength(MAX_SHEET_REFS);
    expect(await patchSeries(env, "p1", id, { imageUrl: "https://img.test/first.png" })).toEqual({ ok: true });
    // Nothing left to fix: nothing written.
    expect(await repairSeries(env, "p1", id)).toEqual({ ok: true, fixes: [] });
  });
});

describe("POST /api/auto/films/:id/retry", () => {
  function app(retry) {
    const a = new Hono();
    a.use("*", async (c, next) => { c.set("projectId", "p1"); c.set("userId", "u1"); await next(); });
    registerAuto(a);
    const env = { FILM_JOBS: { idFromName: (n) => n, get: () => ({ retry }) } };
    return (path) => a.request(path, { method: "POST" }, env);
  }

  it("202s with the running job", async () => {
    const retry = vi.fn(async () => ({ ok: true, job: { id: "f1", status: "running" }, repaired: null }));
    const res = await app(retry)("/api/auto/films/f1/retry");
    expect(res.status).toBe(202);
    expect(retry).toHaveBeenCalledWith("f1");
    expect((await res.json()).job.status).toBe("running");
  });

  it("maps a refusal to its status with the one-line message", async () => {
    const retry = vi.fn(async () => ({ ok: false, code: "busy", message: "Another story is being made.", job: null }));
    const res = await app(retry)("/api/auto/films/f1/retry");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "busy", message: "Another story is being made." });
  });
});
