// The Film job's "Sitting" stage (#69) against a FAKE Daytona runner, with the
// runner page played by hand through the REAL token-authenticated routes
// (routes/sitting-runner.js) on an in-memory D1 and R2: start → pending with
// { elapsed, target } → the page keeps its film → done with the kept url. And
// the failures: the page reports `failed`, the box dies — both throw, and the
// retry starts a fresh attempt with a fresh token.
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { makeEnv } from "./_fakes.js";
import { FILM_STAGES, advanceFilm } from "../../worker/src/lib/film-job.js";
import { runSittingStage, sittingSpend } from "../../worker/src/lib/film-stages/sitting.js";
import { registerSittingRunner } from "../../worker/src/routes/sitting-runner.js";
import { createSeries, readSittings, replaceCueSheet } from "../../worker/src/lib/director.js";
import { mintSittingToken, verifySittingToken } from "../../worker/src/lib/sitting-token.js";

const PID = "p1";
const SECRET = "test-secret";

async function setup() {
  const env = makeEnv({
    FAL_KEY: "platform-key",
    WORKER_PUBLIC_URL: "https://studio.test",
    FLUE_PROXY_SECRET: SECRET,
  });
  const res = await createSeries(env, PID, { title: "The Last Lamp", prompt: "A cat relights a lighthouse.", aspectRatio: "16:9" });
  expect(res.ok).toBe(true);
  const beats = Array.from({ length: 30 }, (_, i) => ({ offset: i * 4, prompt: `Beat ${i + 1}` }));
  const cue = await replaceCueSheet(env, PID, res.series.id, beats);
  expect(cue.issues).toBeUndefined();
  const job = { id: "film-1", prompt: "a cat", projectId: PID, userId: "u1", episodeId: null, steps: [] };
  const results = { stills: { seriesId: res.series.id } };
  const app = new Hono();
  registerSittingRunner(app);
  const call = (path, init = {}) => app.request(path, init, env);
  return { env, job, results, seriesId: res.series.id, call };
}

/** A Daytona stand-in: records each start, answers each poll from `box`. */
function fakeRunner() {
  const r = {
    starts: [],
    box: { status: "running", error: null },
    async start(_env, spec) {
      r.starts.push(spec);
      return `job-${r.starts.length}`;
    },
    async poll() {
      return r.box;
    },
  };
  return r;
}

const tokenOf = (spec) => new URL(spec.runnerUrl).hash.replace(/^#t=/, "");
const withStep = (job, result, extra = {}) => ({ ...job, steps: [{ key: "sitting", status: "running", result, ...extra }] });

describe("the Sitting stage", () => {
  it("sits after the stills", () => {
    const keys = FILM_STAGES.map((s) => s.key);
    expect(keys.indexOf("sitting")).toBe(keys.indexOf("stills") + 1);
    expect(FILM_STAGES.find((s) => s.key === "sitting")).toMatchObject({ label: "Sitting", paid: true });
  });

  it("starts a box, reports { elapsed, target } while pending, and completes with the kept film", async () => {
    const { env, job, results, seriesId, call } = await setup();
    const runner = fakeRunner();
    let clock = Date.now();
    const now = () => clock;

    // 1. Start: a box pointed at the runner page, the token in the fragment.
    const first = await runSittingStage({ job, results, env, attempt: 1 }, { runner, now });
    expect(first.pending).toBe(true);
    expect(runner.starts).toHaveLength(1);
    expect(runner.starts[0].runnerUrl).toMatch(/^https:\/\/studio\.test\/sitting-runner\.html#t=/);
    const token = tokenOf(runner.starts[0]);
    expect(await verifySittingToken(token, SECRET, { now: clock })).toMatchObject({
      filmId: "film-1", projectId: PID, seriesId, userId: "u1", attempt: 1,
    });
    expect(first.result).toMatchObject({ jobId: "job-1", attempt: 1, elapsed: 0 });
    expect(first.result.target).toBeGreaterThanOrEqual(120);

    // 2. The page loads its Screening and reports progress, as the runner does.
    const headers = { "x-sitting-token": token };
    const scr = await call("/api/sitting-runner/screening", { headers });
    expect(scr.status).toBe(200);
    const plan = await scr.json();
    expect(plan.configure).toBeTruthy();
    expect(plan.filmSeconds).toBeGreaterThan(0);
    expect(plan.maxWallSeconds).toBeGreaterThan(240);
    const beat = await call("/api/sitting-runner/progress", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ state: "live", filmS: 42, target: 130, reel: 1 }),
    });
    expect(beat.status).toBe(200);

    clock += 90_000;
    const mid = await runSittingStage({ job: withStep(job, first.result), results, env, attempt: 1 }, { runner, now });
    expect(mid.pending).toBe(true);
    expect(mid.result).toMatchObject({ elapsed: 42, target: 130, state: "live", jobId: "job-1" });
    expect(mid.summary).toMatch(/0:42 of 2:10/);
    expect(runner.starts).toHaveLength(1); // no second box

    // 3. The page keeps the film: a raw video body, filed as a sitting.
    const film = await call("/api/sitting-runner/film?seconds=131&final=ended", {
      method: "POST",
      headers: { ...headers, "content-type": "video/mp4" },
      body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    });
    expect(film.status).toBe(200);
    const kept = (await film.json()).sitting;

    clock += 60_000;
    const done = await runSittingStage({ job: withStep(job, mid.result), results, env, attempt: 1 }, { runner, now });
    expect(done.pending).toBeUndefined();
    expect(done.result).toMatchObject({
      seriesId,
      sittingId: kept.id,
      file: kept.file,
      url: `/director-media/${kept.file}`,
      seconds: 131,
      attempt: 1,
    });
    expect(done.result.fileUrl).toMatch(/^https:\/\/studio\.test\/files\/media\/p1\/director\//);
    expect(done.spend).toBeGreaterThan(0);

    const ledger = await readSittings(env, PID);
    expect(ledger.kept[0]).toMatchObject({ id: kept.id, filmId: "film-1", seriesId, contentType: "video/mp4" });
  });

  it("throws when the page reports a failed session, with the minimum billed", async () => {
    const { env, job, results, call } = await setup();
    const runner = fakeRunner();
    const first = await runSittingStage({ job, results, env, attempt: 1 }, { runner });
    const headers = { "x-sitting-token": tokenOf(runner.starts[0]), "content-type": "application/json" };
    await call("/api/sitting-runner/progress", { method: "POST", headers, body: JSON.stringify({ state: "live", filmS: 12 }) });
    await call("/api/sitting-runner/progress", {
      method: "POST", headers, body: JSON.stringify({ state: "failed", filmS: 12, message: "the stream stopped", detail: "fal: runner_error" }),
    });
    const err = await runSittingStage({ job: withStep(job, first.result), results, env, attempt: 1 }, { runner }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/failed at 0:12.*fal: runner_error/);
    expect(err.spend).toBeCloseTo(sittingSpend({ state: "failed", filmS: 12 }, 0), 6);
    expect(err.spend).toBeGreaterThanOrEqual(60 * 0.02);
  });

  it("throws when the box dies or exits without a film", async () => {
    const { env, job, results } = await setup();
    const runner = fakeRunner();
    const first = await runSittingStage({ job, results, env, attempt: 1 }, { runner });
    runner.box = { status: "error", error: "exit 1\nchrome crashed" };
    await expect(runSittingStage({ job: withStep(job, first.result), results, env, attempt: 1 }, { runner })).rejects.toThrow(/box failed.*chrome crashed/s);
    runner.box = { status: "done", error: null };
    await expect(runSittingStage({ job: withStep(job, first.result), results, env, attempt: 1 }, { runner })).rejects.toThrow(/without keeping a film/);
  });

  it("is retried once as a fresh attempt, then stops the job with its spend", async () => {
    const { env, job, results } = await setup();
    const runner = fakeRunner();
    runner.box = { status: "error", error: "fal said no" };
    const stages = [{ key: "sitting", label: "Sitting", paid: true, run: (ctx) => runSittingStage({ ...ctx, results }, { runner }) }];
    let film = { ...job, status: "running", spend: {} };
    const deps = { env, stages, commit: async () => {} };

    film = await advanceFilm(film, deps); // attempt 1 starts
    expect(film.steps[0]).toMatchObject({ status: "running", pending: true });
    film = await advanceFilm(film, deps); // box failed → retrying
    expect(film.steps[0].status).toBe("retrying");
    film = await advanceFilm(film, deps); // attempt 2: a fresh box and token
    expect(runner.starts).toHaveLength(2);
    expect((await verifySittingToken(tokenOf(runner.starts[1]), SECRET)).attempt).toBe(2);
    film = await advanceFilm(film, deps); // fails again → stopped
    expect(film.status).toBe("stopped");
    expect(film.stopped).toMatchObject({ stage: "sitting" });
    expect(film.spend.sitting).toBeGreaterThan(0);
  });
});

describe("the runner's token routes", () => {
  it("refuse a missing, forged or expired token", async () => {
    const { call, seriesId } = await setup();
    expect((await call("/api/sitting-runner/screening")).status).toBe(401);
    expect((await call("/api/sitting-runner/screening", { headers: { "x-sitting-token": "abc.def" } })).status).toBe(401);

    const claims = { filmId: "film-1", projectId: PID, seriesId, userId: "u1", attempt: 1 };
    const forged = await mintSittingToken(claims, "another-secret");
    expect((await call("/api/sitting-runner/screening", { headers: { "x-sitting-token": forged } })).status).toBe(401);

    const expired = await mintSittingToken(claims, SECRET, { now: Date.now() - 2 * 60 * 60 * 1000 });
    expect((await call("/api/sitting-runner/screening", { headers: { "x-sitting-token": expired } })).status).toBe(401);
    expect((await call("/api/sitting-runner/fal/proxy", { method: "POST", headers: { "x-sitting-token": expired } })).status).toBe(401);
    expect((await call("/api/sitting-runner/film", { method: "POST", headers: { "x-sitting-token": expired, "content-type": "video/mp4" }, body: new Uint8Array([1]) })).status).toBe(401);

    // A proxy-hop token (another issuer, same secret) is not a sitting token.
    const { mintToken, AGENT_ISSUER } = await import("../../worker/src/lib/proxy-token.js");
    const agent = await mintToken("u1", SECRET, AGENT_ISSUER);
    expect((await call("/api/sitting-runner/screening", { headers: { "x-sitting-token": agent } })).status).toBe(401);

    const good = await mintSittingToken(claims, SECRET);
    expect((await call(`/api/sitting-runner/screening?t=${encodeURIComponent(good)}`)).status).toBe(200);
  });

  it("refuse progress from an attempt that is no longer the Film's", async () => {
    const { env, job, results, call } = await setup();
    const runner = fakeRunner();
    await runSittingStage({ job, results, env, attempt: 1 }, { runner });
    const old = tokenOf(runner.starts[0]);
    await runSittingStage({ job: withStep(job, { jobId: "job-1", attempt: 1 }), results, env, attempt: 2 }, { runner });
    const res = await call("/api/sitting-runner/progress", {
      method: "POST",
      headers: { "x-sitting-token": old, "content-type": "application/json" },
      body: JSON.stringify({ state: "live", filmS: 5 }),
    });
    expect(res.status).toBe(409);
  });
});
