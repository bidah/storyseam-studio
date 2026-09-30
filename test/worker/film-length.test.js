// A Film's LENGTH, chosen in the /director-story gear (or by make_film's
// `seconds`) rather than written into the prompt: it rides on the job as
// `job.seconds`, wins over any length the prompt states, survives the queue,
// and reaches every stage that plans the Film. A bad value is refused at the
// door (400), before a job exists.
//
// And the ceiling itself: every step up to 5:00 is run through the REAL
// sheets → shotlist → cue sheet stages and the REAL Reel planner (the run
// stage's `buildRun`), then pinned the way the stills stage pins — and the
// Series' own validation has to accept the result.
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { makeEnv, makeDocsDB } from "./_fakes.js";
import { confirmPlan, startFilm } from "../../worker/src/lib/film-job.js";
import { startNextQueued, submitFilm } from "../../worker/src/lib/film-queue.js";
import { registerAuto } from "../../worker/src/routes/auto.js";
import { runSheetsStage } from "../../worker/src/lib/film-stages/sheets.js";
import { runShotlistStage } from "../../worker/src/lib/film-stages/shotlist.js";
import { runCueSheetStage } from "../../worker/src/lib/film-stages/cuesheet.js";
import { saveWorld } from "../../worker/src/routes/world.js";
import { readSeries } from "../../worker/src/lib/director.js";
import { buildRun, issuesOf, runErrors } from "../../worker/src/lib/shot-sheet-run.js";
import { validateSheet, withSeams } from "../../worker/src/lib/shot-sheet.ts";
import { FILM_MAX_SECONDS, FILM_STEPS, planFilm } from "../../worker/src/lib/film-plan.ts";
import { MAX_DIRECTIONS, MAX_REEL_CHANGES } from "../../worker/src/lib/series.ts";

const PID = "p1";
const WORLD = {
  title: "The Last Lamp",
  logline: "A cat, a dark lighthouse, and one night to save the fleet.",
  characters: [{ name: "Mote", role: "Protagonist", appearance: "Grey tabby" }],
  locations: [{ name: "Lamp room", description: "Brass and glass" }],
};
const SHEETS_ANSWER = {
  renderClause: "Painterly 2D.",
  styles: [{ name: "House style", prompt: "A style frame." }],
  sheets: [
    { kind: "character", name: "Mote", prompt: "Mote turnaround." },
    { kind: "location", name: "Lamp room", prompt: "Lamp room, three views." },
  ],
};
const shots = (n) => ({
  shots: Array.from({ length: n }, (_, i) => ({
    beat: "B1", beatTitle: "Night", location: "lamp-room", dur: 4, characters: ["Mote"],
    camera: "Wide", action: `Shot ${i + 1}: Mote climbs.`, dialogue: "(no dialogue)",
    audioSync: "wind", prompt: `Mote climbs, shot ${i + 1}.`,
  })),
});
const model = {
  json: vi.fn(async ({ messages }) => (messages[0].content.includes("art department") ? SHEETS_ANSWER : shots(60))),
};
const imageDeps = {
  fal: {
    submit: async () => ({ requestId: `img-${Math.random().toString(36).slice(2)}` }),
    poll: async (_k, _e, id) => ({ done: true, url: `https://v3.fal.media/files/${id}.png` }),
  },
  fetch: async () => new Response(new Uint8Array([137, 80, 78, 71])),
  sleep: async () => {},
};

const open = { availability: async () => ({ ok: true }), allowance: async () => ({ ok: true }), autoSettings: async () => ({ auto: true }) };

describe("the Film's length ceiling — every step through the real planner", () => {
  it("the steps run 0:30 … 5:00", () => {
    expect(FILM_MAX_SECONDS).toBe(300);
    expect(FILM_STEPS).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  });

  it.each(FILM_STEPS.map((s) => [s]))(
    "%is: ≤64 beats, ≤5 reels, every clip valid, every pin accepted by the Series",
    async (seconds) => {
      const env = makeEnv({ FAL_KEY: "platform-key", WORKER_PUBLIC_URL: "https://studio.test" });
      await saveWorld(env, PID, { ...WORLD, source: "auto" });
      // The prompt says one length; the job's own `seconds` must win.
      const job = { id: "film-1", prompt: "a two-minute cat film", seconds, projectId: PID, userId: "u1", steps: [] };
      const results = { world: { idea: "A cat relights the lamp.", title: WORLD.title } };
      const sheets = await runSheetsStage({ job, results, env, model }, imageDeps);
      await runShotlistStage({ job, results, env, model });
      const cue = await runCueSheetStage({ job, results: { ...results, sheets: sheets.result }, env });

      const plan = planFilm({ seconds });
      expect(cue.result.seconds).toBe(seconds);
      expect(cue.result.beats).toBe(plan.beats);
      expect(cue.result.beats).toBeLessThanOrEqual(MAX_DIRECTIONS);

      // The run stage's own planning call.
      const series = await readSeries(env, PID, sheets.result.seriesId);
      const run = buildRun(env, PID, series);
      expect(runErrors(run.plan, run.sheets)).toEqual([]);
      expect(run.plan.seams.length).toBeLessThanOrEqual(MAX_REEL_CHANGES);
      expect(run.plan.reels.length).toBeLessThanOrEqual(MAX_REEL_CHANGES + 1);
      for (const sheet of run.sheets) expect(validateSheet(sheet)).toEqual([]);

      // Pin every frame the plan draws, as the stills stage would, on the
      // seamed Series — the Director's validation must accept all of it.
      const { reelChanges, directions } = withSeams(series, run.plan.seams);
      const drawn = new Set(run.plan.clips.flat().filter((s) => s.kind === "pin").map((s) => s.offset));
      const pinned = {
        ...series,
        imageUrl: "/director-media/opening.png",
        reelChanges,
        directions: directions.map((d) =>
          drawn.has(d.offset) ? { ...d, endImageUrl: `/director-media/pin_${d.offset}.png` } : d,
        ),
      };
      expect(issuesOf(pinned)).toEqual([]);
      expect(drawn.size).toBeGreaterThan(0);
      console.info(
        `[length] ${seconds}s: ${cue.result.beats} beats every ${cue.result.spacing}s · ` +
          `${run.plan.reels.length} reels · ${run.plan.seams.length} seams · ${drawn.size} pins · ` +
          `${run.plan.skipped.length} skipped · clips ${run.sheets.map((s) => `${s.shots.length}@${s.duration}s`).join(",")}`,
      );
    },
  );
});

describe("job.seconds", () => {
  it("startFilm stores a valid length and refuses any other", async () => {
    const ok = await startFilm(null, { prompt: "a robot", seconds: 180, userId: "u1", projectId: PID }, open);
    expect(ok.job.seconds).toBe(180);
    const none = await startFilm(null, { prompt: "a robot", userId: "u1", projectId: PID }, open);
    expect(none.job).not.toHaveProperty("seconds");
    for (const bad of [90, 181, 330, "180", 0, -30, Infinity]) {
      const res = await startFilm(null, { prompt: "a robot", seconds: bad, userId: "u1", projectId: PID }, open);
      expect(res.ok).toBe(false);
      expect(res.refusal.code).toBe("invalid");
    }
  });

  it("a queued Film keeps its seconds when it reaches the front", async () => {
    const running = { id: "f0", status: "running", steps: [] };
    const q = await submitFilm({ job: running, queue: [] }, { prompt: "next", seconds: 240, userId: "u1", projectId: PID }, open);
    expect(q.queued).toBe(true);
    expect(q.item.seconds).toBe(240);
    const next = await startNextQueued({ job: { ...running, status: "done" }, queue: q.queue }, open);
    expect(next.job.seconds).toBe(240);
  });

  it("the confirm card quotes the job's seconds over the prompt's", () => {
    const { plan } = confirmPlan({ prompt: "a ten minute epic", seconds: 150 }, { characters: [{}], places: [] });
    expect(plan.seconds).toBe(150);
    expect(plan.length).toBe("2:30");
    expect(plan.capped).toBe(false);
  });

  it("the cue sheet plans the job's seconds, not the prompt's", async () => {
    const env = makeEnv({ FAL_KEY: "platform-key" });
    await saveWorld(env, PID, { ...WORLD, source: "auto" });
    const job = { id: "film-2", prompt: "a four minute film", seconds: 180, projectId: PID, userId: "u1", steps: [] };
    const results = { world: { idea: "A cat.", title: WORLD.title } };
    const sheets = await runSheetsStage({ job, results, env, model }, imageDeps);
    await runShotlistStage({ job, results, env, model });
    const cue = await runCueSheetStage({ job, results: { ...results, sheets: sheets.result }, env });
    expect(cue.result).toMatchObject({ seconds: 180, beats: 45, spacing: 4 });
  });
});

describe("POST /api/auto/films { seconds }", () => {
  const appWith = () => {
    const start = vi.fn(async (input) => ({ ok: true, job: { id: "f1", prompt: input.prompt, seconds: input.seconds } }));
    // The start route makes the Film's own project (a real schema) and checks
    // availability + allowance first, so it needs the DB and the keys too.
    const env = {
      ...makeEnv({ DB: makeDocsDB(readFileSync(new URL("../../worker/schema.sql", import.meta.url), "utf8")) }),
      FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g",
      FILM_JOBS: { idFromName: (n) => n, get: () => ({ start, film: async () => null }) },
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("userId", "u1");
      c.set("projectId", PID);
      await next();
    });
    registerAuto(app);
    const post = (body) =>
      app.request("/api/auto/films", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    return { post, start };
  };

  it("passes a valid length to the job", async () => {
    const { post, start } = appWith();
    const res = await post({ prompt: "a robot", seconds: 300 });
    expect(res.status).toBe(202);
    expect(start.mock.calls[0][0]).toMatchObject({ prompt: "a robot", seconds: 300 });
  });

  it("omits it when not sent", async () => {
    const { post, start } = appWith();
    await post({ prompt: "a robot" });
    expect(start.mock.calls[0][0].seconds).toBeUndefined();
  });

  it.each([[100], [185], [330], ["180"], [true]])("refuses %j with a 400 and starts nothing", async (seconds) => {
    const { post, start } = appWith();
    const res = await post({ prompt: "a robot", seconds });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, refusal: { code: "invalid" } });
    expect(start).not.toHaveBeenCalled();
  });
});
