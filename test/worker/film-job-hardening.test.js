// Job hardening (#72): retry once, stop and report, one Film at a time.
// Runs the runner against FAKE stage runners (deps.stages), so it holds no
// matter which real stages FILM_STAGES carries.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { makeEnv, makeDocsDB, DOCS_SCHEMA } from "./_fakes.js";
import {
  advanceFilm,
  allowanceKindOf,
  event,
  runFilm,
  startFilm,
  totalSpend,
} from "../../worker/src/lib/film-job.js";
import { MAX_QUEUE, publicQueue, startNextQueued, submitFilm } from "../../worker/src/lib/film-queue.js";
import { checkAllowance, countFilm } from "../../worker/src/lib/film-allowance.js";

const ALLOWANCE_SCHEMA = readFileSync(
  new URL("../../worker/migrations/003-film-allowance.sql", import.meta.url),
  "utf8",
);
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const envWith = (extra = {}) => ({ ...makeEnv({ DB: makeDocsDB(DOCS_SCHEMA + "\n" + ALLOWANCE_SCHEMA) }), ...KEYS, ...extra });

// A fake stage: `plan` is a list of outcomes, one per attempt —
// "ok" or { throw: message, spend? }; each success spends `spend`.
function fakeStage(key, { plan = ["ok"], spend = 0, paid = false } = {}) {
  let i = 0;
  const run = vi.fn(async ({ attempt, results }) => {
    const o = plan[Math.min(i++, plan.length - 1)];
    if (o !== "ok") {
      const err = new Error(o.throw);
      if (o.spend) err.spend = o.spend;
      throw err;
    }
    return { summary: `${key} made`, result: { key, attempt, saw: Object.keys(results) }, spend };
  });
  return { key, label: key.toUpperCase(), paid, run };
}

const recorder = () => {
  const events = [];
  return { events, commit: async (_job, ev) => events.push(ev) };
};

let seq = 0;
async function started(env, over = {}) {
  const res = await startFilm(null, { prompt: "a film", userId: "u1", projectId: "p1", ...over }, { env, newId: () => `film-${++seq}` });
  expect(res.ok).toBe(true);
  return res.job;
}

describe("the Film job runner", () => {
  it("runs the stages in order, each seeing the results before it", async () => {
    const env = envWith();
    const stages = [fakeStage("a"), fakeStage("b"), fakeStage("c")];
    const { events, commit } = recorder();
    const job = await runFilm(await started(env), { env, stages, commit });
    expect(job.status).toBe("done");
    expect(job.steps.map((s) => s.key)).toEqual(["a", "b", "c"]);
    expect(job.steps[2].result.saw).toEqual(["a", "b"]);
    expect(events.map((e) => [e.kind, e.step])).toEqual([
      ["step.started", "a"], ["step.done", "a"],
      ["step.started", "b"], ["step.done", "b"],
      ["step.started", "c"], ["step.done", "c"],
      ["film.done", null],
    ]);
  });

  it("retries a stage that fails once, and the job completes", async () => {
    const env = envWith();
    const flaky = fakeStage("b", { plan: [{ throw: "timeout", spend: 0.5 }, "ok"], spend: 1.25, paid: true });
    const stages = [fakeStage("a"), flaky, fakeStage("c")];
    const { events, commit } = recorder();

    // One advance per attempt, like one alarm per attempt in the DO.
    let job = await started(env);
    job = await advanceFilm(job, { env, stages, commit }); // a
    job = await advanceFilm(job, { env, stages, commit }); // b, first try fails
    expect(job.status).toBe("running");
    expect(job.steps[1]).toMatchObject({ key: "b", status: "retrying", failures: 1, error: "timeout" });
    job = await runFilm(job, { env, stages, commit });

    expect(flaky.run).toHaveBeenCalledTimes(2);
    expect(flaky.run.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2]);
    expect(job.status).toBe("done");
    expect(job.steps[1]).toMatchObject({ status: "done", error: null, result: { attempt: 2 } });
    expect(job.steps).toHaveLength(3); // the retry reuses the card
    expect(job.spend).toEqual({ b: 1.75 }); // the failed try's spend is kept too
    expect(events.map((e) => e.kind)).toEqual([
      "step.started", "step.done",
      "step.started", "step.retrying", "step.done",
      "step.started", "step.done",
      "film.done",
    ]);
  });

  it("stops after a second failure, keeping what was made and summing the spend", async () => {
    const env = envWith();
    const stages = [
      fakeStage("a", { spend: 0.1 }),
      fakeStage("b", { spend: 2, paid: true }),
      fakeStage("c", { plan: [{ throw: "fal 500", spend: 0.4 }, { throw: "fal 500 again" }], paid: true }),
      fakeStage("d"),
    ];
    const { events, commit } = recorder();
    const job = await runFilm(await started(env), { env, stages, commit });

    expect(job.status).toBe("stopped");
    expect(job.error).toBe("C: fal 500 again");
    expect(job.steps.map((s) => [s.key, s.status])).toEqual([["a", "done"], ["b", "done"], ["c", "failed"]]);
    expect(stages[3].run).not.toHaveBeenCalled();
    // Everything already made is kept.
    expect(job.steps[0].result).toMatchObject({ key: "a" });
    expect(job.steps[1].result).toMatchObject({ key: "b" });
    expect(job.spend).toEqual({ a: 0.1, b: 2, c: 0.4 });
    expect(totalSpend(job)).toBe(2.5);
    expect(job.stopped).toEqual({
      stage: "c",
      label: "C",
      reason: "fal 500 again",
      kept: [
        { key: "a", label: "A", summary: "a made" },
        { key: "b", label: "B", summary: "b made" },
      ],
      spent: 2.5,
    });
    expect(events.map((e) => [e.kind, e.step])).toEqual([
      ["step.started", "a"], ["step.done", "a"],
      ["step.started", "b"], ["step.done", "b"],
      ["step.started", "c"], ["step.retrying", "c"], ["step.failed", "c"],
      ["film.stopped", null],
    ]);
    const last = events.at(-1);
    expect(last.resource).toBe("auto");
    expect(last.job.status).toBe("stopped");
    expect(last.job.userId).toBeUndefined();
  });

  it("does not use up the retry when an evicted attempt is re-run", async () => {
    const env = envWith();
    const stages = [fakeStage("a", { plan: [{ throw: "x" }, { throw: "y" }] })];
    let job = await started(env);
    // The object died mid-retry: the step is still `retrying` with one failure.
    job = { ...job, steps: [{ key: "a", label: "A", status: "retrying", failures: 1 }] };
    job = await advanceFilm(job, { env, stages });
    expect(job.status).toBe("stopped"); // the second real failure, not a third
    expect(stages[0].run).toHaveBeenCalledTimes(1);
  });

  it("never counts a stopped Film against the allowance", async () => {
    const env = envWith();
    const stages = [fakeStage("a", { plan: [{ throw: "x" }] })];
    const job = await runFilm(await started(env), { env, stages });
    expect(job.status).toBe("stopped");
    expect(allowanceKindOf(job)).toBe("failed");
    const res = await countFilm(env, "u1", { filmId: job.id, kind: allowanceKindOf(job) });
    expect(res.counted).toBe(false);
    expect((await checkAllowance(env, "u1")).used).toBe(0);
    expect(allowanceKindOf({ status: "done" })).toBe("new");
  });
});

// A tiny stand-in for the FilmJobs DO: the same calls, in the same order,
// against an in-memory `{ job, queue }`.
function fakeProject(env, stages, deps = {}) {
  const state = { job: null, queue: [] };
  const { events, commit: rec } = recorder();
  const commit = async (job, ev) => {
    state.job = job;
    await rec(job, ev);
  };
  return {
    state,
    events,
    async submit(prompt, userId = "u1") {
      const res = await submitFilm(state, { prompt, userId, projectId: "p1" }, { env, ...deps });
      if (!res.ok) return res;
      state.queue = res.queue;
      if (res.queued) {
        events.push({ kind: "film.queued", filmId: res.item.id });
        return res;
      }
      await commit(res.job, event("film.started", res.job));
      return res;
    },
    // One alarm: advance the running job, or start the next queued one.
    async alarm() {
      if (state.job?.status === "running") {
        const job = await advanceFilm(state.job, { env, stages, commit });
        if (job.status === "running") return;
      }
      const res = await startNextQueued(state, { env, ...deps });
      state.queue = res.queue;
      for (const r of res.refused) await commit(r, event("film.refused", r));
      if (res.job) await commit(res.job, event("film.started", res.job));
    },
    async drain(max = 50) {
      while (max-- > 0 && (state.job?.status === "running" || state.queue.length)) await this.alarm();
    },
  };
}

describe("one Film at a time — the queue", () => {
  it("queues a second prompt and starts it after the first ends", async () => {
    const env = envWith();
    const project = fakeProject(env, [fakeStage("a"), fakeStage("b")]);

    const first = await project.submit("first film");
    expect(first.ok).toBe(true);
    expect(first.queued).toBeUndefined();
    const firstId = first.job.id;

    const second = await project.submit("second film");
    expect(second).toMatchObject({ ok: true, queued: true, position: 1 });
    expect(project.state.job.id).toBe(firstId); // the running Film is untouched
    expect(publicQueue(project.state.queue)).toEqual([
      expect.objectContaining({ prompt: "second film", position: 1 }),
    ]);
    expect(publicQueue(project.state.queue)[0].userId).toBeUndefined();

    await project.alarm(); // first: a
    expect(project.state.job.id).toBe(firstId);
    await project.drain();

    const kinds = project.events.map((e) => [e.kind, e.filmId]);
    const firstDone = kinds.findIndex(([k, id]) => k === "film.done" && id === firstId);
    const secondStart = kinds.findIndex(([k, id]) => k === "film.started" && id === second.item.id);
    expect(firstDone).toBeGreaterThan(-1);
    expect(secondStart).toBeGreaterThan(firstDone);
    expect(project.state.job).toMatchObject({ id: second.item.id, prompt: "second film", status: "done" });
    expect(project.state.queue).toEqual([]);
  });

  it("starts the next queued Film after a STOPPED one too", async () => {
    const env = envWith();
    const project = fakeProject(env, [fakeStage("a", { plan: [{ throw: "x" }, { throw: "x" }, "ok"] })]);
    await project.submit("doomed");
    const next = await project.submit("next");
    await project.drain();
    expect(project.events.map((e) => e.kind)).toContain("film.stopped");
    expect(project.state.job).toMatchObject({ id: next.item.id, status: "done" });
  });

  it("re-checks the allowance when a queued Film reaches the front", async () => {
    const env = envWith();
    // 9 of 10 used: the first Film may start and the second may queue…
    for (let i = 0; i < 9; i++) await countFilm(env, "u1", { filmId: `old-${i}`, kind: "new" });
    const allowance = vi.fn(checkAllowance);
    // The last stage keeps the Film and counts it, as the scoring slice will.
    const keep = {
      key: "keep",
      label: "Keep",
      run: async ({ job }) => {
        await countFilm(env, job.userId, { filmId: job.id, kind: "new" });
        return { summary: "kept" };
      },
    };
    const project = fakeProject(env, [keep], { allowance });
    const first = await project.submit("first");
    const second = await project.submit("second");
    expect(second.queued).toBe(true);
    expect(allowance).toHaveBeenCalledTimes(2);

    // …then the first finishes and counts, using the last one; the same alarm
    // hands over to the queued Film, which is checked again at the front.
    await project.alarm();
    expect(project.events.some((e) => e.kind === "film.done" && e.filmId === first.job.id)).toBe(true);
    expect(allowance).toHaveBeenCalledTimes(3);
    expect(project.state.job).toMatchObject({ id: second.item.id, status: "refused", steps: [] });
    expect(project.state.job.error).toMatch(/10 of your 10 Films/);
    expect(project.events.at(-1)).toMatchObject({ kind: "film.refused", filmId: second.item.id });
    expect(project.state.queue).toEqual([]);
  });

  it("refuses to queue an author already over their allowance, and caps the queue", async () => {
    const env = envWith();
    const project = fakeProject(env, [fakeStage("a")]);
    await project.submit("running");
    for (let i = 0; i < MAX_QUEUE; i++) expect((await project.submit(`q${i}`)).queued).toBe(true);
    const full = await project.submit("one too many");
    expect(full.ok).toBe(false);
    expect(full.refusal.code).toBe("busy");

    const env2 = envWith();
    for (let i = 0; i < 10; i++) await countFilm(env2, "u1", { filmId: `f${i}`, kind: "new" });
    const res = await submitFilm(
      { job: { status: "running" }, queue: [] },
      { prompt: "late", userId: "u1", projectId: "p1" },
      { env: env2 },
    );
    expect(res.ok).toBe(false);
    expect(res.refusal.code).toBe("allowance");
  });
});
