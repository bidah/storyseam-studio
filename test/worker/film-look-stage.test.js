// The Film job's first stage: which house look the Film is made in.
import { describe, it, expect, vi } from "vitest";
import { runLookStage, LOOK_MODEL } from "../../worker/src/lib/film-stages/look.js";
import { runSheetsStage } from "../../worker/src/lib/film-stages/sheets.js";
import { FILM_STYLES, DEFAULT_FILM_STYLE } from "../../worker/src/lib/film-plan.ts";

const JEV_ANSWER = {
  model: "jev-1.13.0",
  answers: {
    look: {
      type: "choice",
      choice: "pixar",
      confidence: 0.9,
      probabilities: { pixar: 0.82, "anime-80s": 0.1, "live-action": 0.05, "2d-folklore": 0.03 },
    },
  },
};

const envWithAI = (run) => ({ AI: { run: vi.fn(run) } });

describe("the Film job — look stage", () => {
  it("a chosen look is used as is, and the classifier is never asked", async () => {
    const env = envWithAI(async () => JEV_ANSWER);
    const out = await runLookStage({ job: { style: "live-action", prompt: "a pixar like story" }, env });
    expect(out.result).toEqual({ style: "live-action", by: "chosen" });
    expect(out.summary).toMatch(/chosen/);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("classifies the premise with Jev: one choice question over the house looks", async () => {
    const env = envWithAI(async () => JEV_ANSWER);
    const out = await runLookStage({ job: { prompt: "a toy robot learns to dance" }, env });

    expect(out.result).toMatchObject({ style: "pixar", by: "jev", model: "jev-1.13.0", confidence: 0.9 });
    expect(out.result.probabilities.pixar).toBe(0.82);
    expect(out.summary.startsWith("3D Pixar · 82%")).toBe(true);

    expect(env.AI.run).toHaveBeenCalledTimes(1);
    const [model, request] = env.AI.run.mock.calls[0];
    expect(model).toBe("typesafe/jev");
    expect(LOOK_MODEL).toBe("typesafe/jev");
    expect(request.state).toBe("a toy robot learns to dance");
    expect(request.questions.look.type).toBe("choice");
    expect(Object.keys(request.questions.look.criteria).sort()).toEqual(FILM_STYLES.map((s) => s.id).sort());
  });

  it("falls back to the premise's words when the classifier throws", async () => {
    const env = envWithAI(async () => {
      throw new Error("gateway down");
    });
    const out = await runLookStage({ job: { prompt: "a pixar like story" }, env });
    expect(out.result).toEqual({ style: "pixar", by: "keywords", error: "gateway down" });
  });

  it("falls back when the classifier answers a look that isn't one of the house looks", async () => {
    const env = envWithAI(async () => ({
      answers: { look: { type: "choice", choice: "claymation", confidence: 0.7, probabilities: { claymation: 0.7 } } },
    }));
    const out = await runLookStage({ job: { prompt: "a cat saves a lighthouse" }, env });
    expect(out.result).toMatchObject({ style: DEFAULT_FILM_STYLE, by: "keywords" });
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it("the Sheets stage draws in the look the Look stage picked, over the premise's words", async () => {
    const model = { json: vi.fn(async () => { throw new Error("stop after the prompt"); }) };
    const job = { id: "film-1", projectId: "p1", prompt: "an anime mecha story", steps: [] };
    const results = { look: { style: "pixar", by: "jev" }, world: { idea: "An idea." } };
    await expect(
      runSheetsStage({ job, results, env: {}, model }, { readWorld: async () => ({ characters: [{ name: "Mote" }] }) }),
    ).rejects.toThrow(/stop after the prompt/);
    const text = model.json.mock.calls[0][0].messages.map((m) => m.content).join("\n");
    const pixar = FILM_STYLES.find((s) => s.id === "pixar");
    const anime = FILM_STYLES.find((s) => s.id === "anime-80s");
    expect(text).toContain(pixar.look);
    expect(text).not.toContain(anime.look);
  });
});
