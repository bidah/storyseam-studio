// The Auto toggle and the one confirm card (#65). Runs the runner against FAKE
// stage runners (deps.stages), so it holds whatever real stages FILM_STAGES
// carries: a `world` stage, then a paid one that must not run until confirmed.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { makeEnv, makeDocsDB, DOCS_SCHEMA } from "./_fakes.js";
import {
  advanceFilm,
  allowanceKindOf,
  confirmFilm,
  declineFilm,
  runFilm,
  startFilm,
} from "../../worker/src/lib/film-job.js";
import { startNextQueued, submitFilm } from "../../worker/src/lib/film-queue.js";
import { readAutoSettings, writeAutoSettings } from "../../worker/src/lib/auto-settings.js";
import { checkAllowance } from "../../worker/src/lib/film-allowance.js";

const sql = (f) => readFileSync(new URL(`../../worker/migrations/${f}`, import.meta.url), "utf8");
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const envWith = () => ({
  ...makeEnv({ DB: makeDocsDB([DOCS_SCHEMA, sql("003-film-allowance.sql"), sql("004-auto-settings.sql")].join("\n")) }),
  ...KEYS,
});

const WORLD_RESULT = {
  idea: "x",
  characters: [{ name: "A" }, { name: "B" }, { name: "C" }],
  places: [{ name: "P1" }, { name: "P2" }],
};
const stagesFor = () => [
  { key: "world", label: "Idea + World", run: vi.fn(async () => ({ summary: "world", result: WORLD_RESULT })) },
  { key: "sheets", label: "Sheets", paid: true, run: vi.fn(async () => ({ summary: "sheets", result: {}, spend: 0.48 })) },
];
const recorder = () => {
  const events = [];
  return { events, commit: async (_job, ev) => events.push(ev) };
};

let seq = 0;
async function started(env, userId = "u1", prompt = "a three minute film about a fox") {
  const res = await startFilm(null, { prompt, userId, projectId: "p1" }, { env, newId: () => `film-${++seq}` });
  expect(res.ok).toBe(true);
  return res.job;
}

describe("the Auto toggle", () => {
  it("defaults to on, persists per user, and falls back to on without the table", async () => {
    const env = envWith();
    expect(await readAutoSettings(env, "u1")).toEqual({ auto: true });
    expect(await writeAutoSettings(env, "u1", { auto: false })).toEqual({ auto: false });
    expect(await readAutoSettings(env, "u1")).toEqual({ auto: false });
    expect(await readAutoSettings(env, "u2")).toEqual({ auto: true });
    await writeAutoSettings(env, "u1", { auto: true });
    expect(await readAutoSettings(env, "u1")).toEqual({ auto: true });

    const bare = { ...makeEnv({ DB: makeDocsDB(DOCS_SCHEMA) }), ...KEYS };
    expect(await readAutoSettings(bare, "u1")).toEqual({ auto: true });
  });

  it("is snapshotted onto the job when it starts", async () => {
    const env = envWith();
    expect((await started(env)).auto).toBe(true);
    await writeAutoSettings(env, "u1", { auto: false });
    expect((await started(env)).auto).toBe(false);
  });
});

describe("the confirm card", () => {
  it("Auto on: runs straight through — no pause, no card", async () => {
    const env = envWith();
    const stages = stagesFor();
    const { events, commit } = recorder();
    const job = await runFilm(await started(env), { env, stages, commit });
    expect(job.status).toBe("done");
    expect(job.confirm).toBeUndefined();
    expect(events.map((e) => e.kind)).not.toContain("film.awaiting-confirm");
    expect(stages[1].run).toHaveBeenCalledTimes(1);
  });

  it("Auto off: pauses after the World with the plan on the card, before any paid stage", async () => {
    const env = envWith();
    await writeAutoSettings(env, "u1", { auto: false });
    const stages = stagesFor();
    const { events, commit } = recorder();
    let job = await runFilm(await started(env), { env, stages, commit });

    expect(job.status).toBe("awaiting-confirm");
    expect(job.steps.map((s) => [s.key, s.status])).toEqual([["world", "done"]]);
    expect(stages[1].run).not.toHaveBeenCalled();
    expect(events.map((e) => e.kind)).toEqual(["step.started", "step.done", "film.awaiting-confirm"]);

    const { confirm } = job;
    expect(confirm.status).toBe("awaiting");
    expect(confirm.after).toBe("world");
    expect(confirm.plan.length).toBe("3:00");
    expect(confirm.plan.reels).toBeGreaterThanOrEqual(1);
    expect(confirm.plan.sheets).toBe(5); // 3 characters + 2 places
    expect(confirm.plan.estimate.total).toBeGreaterThan(0);
    expect(Object.keys(confirm.plan.estimate.perStage)).toEqual(
      expect.arrayContaining(["referenceSheets", "clips", "sitting", "score", "sandbox"]),
    );
    expect(confirm.summary).toContain("3:00");
    expect(confirm.summary).toContain("5 sheets");

    // Advancing again does nothing while it waits.
    job = await advanceFilm(job, { env, stages, commit });
    expect(job.status).toBe("awaiting-confirm");
    expect(stages[1].run).not.toHaveBeenCalled();
  });

  it("confirm resumes the job and it asks only once", async () => {
    const env = envWith();
    await writeAutoSettings(env, "u1", { auto: false });
    const stages = stagesFor();
    const { events, commit } = recorder();
    let job = await runFilm(await started(env), { env, stages, commit });

    const res = await confirmFilm(job, job.id, { commit });
    expect(res.ok).toBe(true);
    expect(res.job.status).toBe("running");
    expect(res.job.confirm.status).toBe("confirmed");

    job = await runFilm(res.job, { env, stages, commit });
    expect(job.status).toBe("done");
    expect(stages[1].run).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.kind).filter((k) => k === "film.awaiting-confirm")).toHaveLength(1);
    expect(events.map((e) => e.kind).slice(-5)).toEqual([
      "film.awaiting-confirm", "film.confirmed", "step.started", "step.done", "film.done",
    ]);

    // A second answer is refused.
    expect(await confirmFilm(job, job.id, { commit })).toEqual({ ok: false, code: "not-awaiting" });
  });

  it("decline ends the job: nothing further runs, nothing spent, allowance untouched", async () => {
    const env = envWith();
    await writeAutoSettings(env, "u1", { auto: false });
    const stages = stagesFor();
    const { events, commit } = recorder();
    let job = await runFilm(await started(env), { env, stages, commit });
    const before = await checkAllowance(env, "u1");

    expect(await declineFilm(job, "someone-else", { commit })).toEqual({ ok: false, code: "not-found" });
    const res = await declineFilm(job, job.id, { commit });
    expect(res.ok).toBe(true);
    job = res.job;
    expect(job.status).toBe("declined");
    expect(job.confirm.status).toBe("declined");
    expect(events.at(-1).kind).toBe("film.declined");

    job = await runFilm(job, { env, stages, commit });
    expect(job.status).toBe("declined");
    expect(stages[1].run).not.toHaveBeenCalled();
    expect(job.spend).toEqual({});
    expect(allowanceKindOf(job)).toBe("failed");
    expect((await checkAllowance(env, "u1")).used).toBe(before.used);
  });

  it("a Film waiting on its card holds the project; the queue moves on after a decline", async () => {
    const env = envWith();
    await writeAutoSettings(env, "u1", { auto: false });
    const stages = stagesFor();
    const { commit } = recorder();
    const job = await runFilm(await started(env), { env, stages, commit });

    const q = await submitFilm({ job, queue: [] }, { prompt: "next", userId: "u1", projectId: "p1" }, { env });
    expect(q.queued).toBe(true);
    expect((await startNextQueued({ job, queue: q.queue }, { env })).job).toBeNull();

    const { job: declined } = await declineFilm(job, job.id, { commit });
    const next = await startNextQueued({ job: declined, queue: q.queue }, { env });
    expect(next.job?.prompt).toBe("next");
  });
});
