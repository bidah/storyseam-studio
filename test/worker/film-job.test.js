import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { makeEnv, makeDocsDB, DOCS_SCHEMA } from "./_fakes.js";
import {
  FILM_STAGES,
  advanceFilm,
  parseIdeaWorld,
  publicJob,
  runFilm,
  startFilm,
  worldMessages,
} from "../../worker/src/lib/film-job.js";
import { countFilm } from "../../worker/src/lib/film-allowance.js";
import { saveWorld, readWorld } from "../../worker/src/routes/world.js";
import { WORLD_SHAPE } from "../../worker/src/lib/auto-prompts.generated.js";

const ALLOWANCE_SCHEMA = readFileSync(
  new URL("../../worker/migrations/003-film-allowance.sql", import.meta.url),
  "utf8",
);
const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const envWith = (extra = {}) => ({ ...makeEnv({ DB: makeDocsDB(DOCS_SCHEMA + "\n" + ALLOWANCE_SCHEMA) }), ...KEYS, ...extra });

const ANSWER = {
  idea: "A lighthouse keeper's cat must relight the lamp before the storm ships arrive.",
  world: {
    title: "The Last Lamp",
    logline: "A cat, a dark lighthouse, and one night to save the fleet.",
    map: { world: "A storm-battered island lighthouse", protagonist: "Mote the cat", antagonist: "The storm", stakes: "The fleet wrecks", theme: "Small courage" },
    depth: { premise: "Courage is doing the small thing", structure: "Three acts" },
    characters: [
      { name: "Mote", role: "Protagonist", appearance: "Grey tabby, one white paw", sheetImage: { rel: "x" } },
      { name: "Old Ada", archetype: "Mentor", appearance: "Keeper in oilskins" },
    ],
    locations: [{ name: "Lamp room", description: "Brass and glass, lit orange" }],
  },
};

const fakeModel = (answer = ANSWER) => ({ json: vi.fn(async () => answer) });

async function startedJob(env, over = {}) {
  const res = await startFilm(null, { prompt: "a cat saves a lighthouse", userId: "u1", projectId: "p1", ...over }, { env, newId: () => "film-1" });
  expect(res.ok).toBe(true);
  return res.job;
}

describe("the Film job — world stage", () => {
  it("runs Idea + World against a fake model, saves the World, and emits start → done in order (the job then moves on)", async () => {
    const env = envWith();
    const model = fakeModel();
    const events = [];
    const persisted = [];
    const commit = async (job, ev) => {
      persisted.push(job);
      events.push(ev);
    };

    let job = await startedJob(env);
    job = await advanceFilm(job, { env, model, saveWorld, commit });

    expect(events.map((e) => [e.kind, e.step])).toEqual([
      ["step.started", "world"],
      ["step.done", "world"],
    ]);
    for (const e of events) {
      expect(e.resource).toBe("auto");
      expect(e.filmId).toBe("film-1");
      expect(e.job.userId).toBeUndefined(); // the broadcast never carries who
    }
    // The started event already shows the card as running…
    expect(events[0].job.steps).toEqual([expect.objectContaining({ key: "world", label: "Idea + World", status: "running" })]);
    // …and the done event marks it complete with its summary.
    const step = job.steps[0];
    expect(step).toMatchObject({ key: "world", status: "done", summary: "The Last Lamp — 2 characters, 1 place" });
    expect(step.result.idea).toBe(ANSWER.idea);
    expect(step.result.characters.map((c) => c.name)).toEqual(["Mote", "Old Ada"]);
    expect(step.result.places).toEqual([{ name: "Lamp room", description: "Brass and glass, lit orange" }]);
    expect(job.status).toBe("running"); // the sheets stage is next

    // The model was prompted with the playbook's World shape and the author's prompt.
    const { messages } = model.json.mock.calls[0][0];
    expect(messages[0].content).toContain(WORLD_SHAPE);
    expect(messages[1].content).toContain("a cat saves a lighthouse");

    // The World landed through the same helper POST /api/world uses.
    const world = await readWorld(env, "p1");
    expect(world.title).toBe("The Last Lamp");
    expect(world.source).toBe("auto");
    expect(world.characters.map((c) => c.name)).toEqual(["Mote", "Old Ada"]);
    expect(world.characters[0].sheetImage).toBeNull(); // a model can't link a sheet
    expect(world.locations.map((l) => l.slug)).toEqual(["lamp-room"]);
  });

  it("retries once, then stops the job when the model's answer has no World", async () => {
    const env = envWith();
    const events = [];
    let job = await startedJob(env);
    job = await runFilm(job, {
      env, model: fakeModel({ idea: "x" }), saveWorld, commit: async (_j, ev) => events.push(ev),
    });
    expect(events.map((e) => e.kind)).toEqual(["step.started", "step.retrying", "step.failed", "film.stopped"]);
    expect(job.status).toBe("stopped");
    expect(job.steps[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/no World/) });
  });

  it("re-runs a step left running by an evicted object instead of starting a second card", async () => {
    const env = envWith();
    let job = await startedJob(env);
    job = { ...job, steps: [{ key: "world", label: "Idea + World", status: "running", startedAt: "t" }] };
    const events = [];
    job = await advanceFilm(job, { env, model: fakeModel(), saveWorld, commit: async (_j, ev) => events.push(ev) });
    expect(job.steps).toHaveLength(1);
    expect(events.map((e) => e.kind)).toEqual(["step.done"]);
  });

  it("keeps the stage list ordered and keyed", () => {
    expect(FILM_STAGES.map((s) => s.key)).toEqual(["world", "sheets", "shotlist", "cuesheet"]);
    expect(worldMessages("p")).toHaveLength(2);
    expect(() => parseIdeaWorld({ idea: "i", world: { characters: [] } })).toThrow(/no characters/);
    expect(publicJob(null)).toBeNull();
  });
});

describe("the Film job — refusals", () => {
  it("refuses an author over their allowance, and creates nothing", async () => {
    const env = envWith();
    for (let i = 0; i < 10; i++) await countFilm(env, "u1", { filmId: `f${i}`, kind: "new" });
    const res = await startFilm(null, { prompt: "a film", userId: "u1", projectId: "p1" }, { env });
    expect(res.ok).toBe(false);
    expect(res.refusal.code).toBe("allowance");
    expect(res.refusal.message).toMatch(/10 of your 10 Films/);
    expect(res.job).toBeUndefined();
  });

  it("refuses while the kill switch is on", async () => {
    const env = envWith({ AUTO_PAUSED: "Back tomorrow." });
    const res = await startFilm(null, { prompt: "a film", userId: "u1" }, { env });
    expect(res).toEqual({ ok: false, refusal: { code: "paused", message: "Back tomorrow." } });
  });

  it("refuses an empty prompt and a second Film while one is running", async () => {
    const env = envWith();
    expect((await startFilm(null, { prompt: "  ", userId: "u1" }, { env })).refusal.code).toBe("invalid");
    const running = await startedJob(env);
    expect((await startFilm(running, { prompt: "again", userId: "u1" }, { env })).refusal.code).toBe("busy");
  });
});
