// The Film job's "Score" stage (#70): measure the kept film in a (fake)
// sandbox, plan the cue from THAT measurement, render it on a (fake) fal queue
// on the platform key, mix it under the picture in the sandbox and file the
// scored film beside the untouched sitting — across alarms, through the real
// job runner, on a real in-memory D1 and R2.
import { describe, it, expect, vi } from "vitest";
import { makeEnv } from "./_fakes.js";
import { advanceFilm, FILM_STAGES } from "../../worker/src/lib/film-job.js";
import { runScoreStage } from "../../worker/src/lib/film-stages/score.js";
import { createSeries, readSeries, readSittings, updateSittings } from "../../worker/src/lib/director.js";
import { directorKey, mixArgs, mixJobScript, parseMeasurement, scoredName } from "../../worker/src/lib/film-score.js";
import { bedVolumeExpression, pickTurns, DEFAULT_MIX } from "../../worker/src/lib/score-mix.ts";
import { planTotalMs, renderCostUsd, validatePlan } from "../../worker/src/lib/music-plan.ts";
import { FILM_RATES_USD } from "../../worker/src/lib/film-plan.ts";

const PID = "p1";
// The cue sheet says 2:00; the film that was actually kept runs 2:07.4.
const CUE_SHEET_SECONDS = 120;
const FILM_SECONDS = 127.4;
const SITTING_FILE = "sitting_s1_abc.mp4";

/** What the measurement script prints for a 127.4s film with cuts at 31s, 64s, 95s. */
function measurementStdout({ seconds = FILM_SECONDS, audio = true } = {}) {
  const probe = {
    streams: [{ codec_type: "video", codec_name: "h264" }, ...(audio ? [{ codec_type: "audio", codec_name: "aac" }] : [])],
    format: { duration: String(seconds) },
  };
  const scene = [
    [31.2, 0.62], [33.0, 0.31], [64.1, 0.88], [95.6, 0.45], [125.0, 0.9],
  ].map(([t, s], i) => `frame:${i} pts:${Math.round(t * 1000)} pts_time:${t}\nlavfi.scene_score=${s}`).join("\n");
  const rms = Array.from({ length: Math.ceil(seconds) }, (_, s) => {
    const db = s >= 40 && s < 44 ? -12 : -30; // one loud line at 0:40
    return `frame:${s} pts:${s * 48000} pts_time:${s}\nlavfi.astats.Overall.RMS_level=${db}`;
  }).join("\n");
  return `@@PROBE\n${JSON.stringify(probe)}\n@@SCENE\n${scene}\n@@RMS\n${audio ? rms : ""}\n@@END\n`;
}

/** The Daytona sandbox, faked: jobs finish when the test says so; a finished mix writes its output. */
function fakeScorer(env, { stdout = measurementStdout() } = {}) {
  const jobs = new Map(); // id -> { kind, status, spec }
  let n = 0;
  const scorer = {
    startMeasure: vi.fn(async (_env, spec) => {
      const jobId = `m${++n}`;
      jobs.set(jobId, { kind: "measure", status: "running", spec });
      return { jobId, outPath: `/tmp/score-measure-${jobId}.txt` };
    }),
    readMeasure: vi.fn(async () => stdout),
    startMix: vi.fn(async (_env, spec) => {
      const jobId = `x${++n}`;
      jobs.set(jobId, { kind: "mix", status: "running", spec });
      return jobId;
    }),
    poll: vi.fn(async (_env, jobId) => {
      const j = jobs.get(jobId);
      return { status: j.status, error: j.error || null };
    }),
  };
  return {
    scorer,
    jobs,
    finish: async (kind) => {
      for (const j of jobs.values()) {
        if (j.kind !== kind || j.status !== "running") continue;
        j.status = "done";
        if (kind === "mix") await env.BUCKET.put(j.spec.outKey, new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]));
      }
    },
    fail: (kind, error) => {
      for (const j of jobs.values()) if (j.kind === kind && j.status === "running") Object.assign(j, { status: "error", error });
    },
  };
}

/** fal's music queue, faked at `fetch`. */
function fakeFal() {
  const requests = new Map();
  const submits = [];
  let n = 0;
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://v3.fal.media/")) return new Response(new Uint8Array([73, 68, 51, 4]));
    const m = /^https:\/\/queue\.fal\.run\/elevenlabs\/music\/requests\/([^/]+)(\/status)?$/.exec(u);
    if (m) {
      const req = requests.get(m[1]);
      if (m[2]) return Response.json({ status: req.status, ...(req.error ? { error: req.error } : {}) });
      return Response.json({ audio: { url: `https://v3.fal.media/files/${m[1]}.mp3`, duration: FILM_SECONDS } });
    }
    if (u !== "https://queue.fal.run/elevenlabs/music/v2.5") throw new Error(`unexpected fetch ${u}`);
    const id = `c${++n}-request`;
    submits.push({ body: JSON.parse(init.body), auth: init.headers.authorization, id });
    requests.set(id, { status: "IN_QUEUE" });
    return Response.json({ request_id: id });
  });
  return {
    fetch,
    submits,
    finish: () => { for (const r of requests.values()) if (r.status === "IN_QUEUE") r.status = "COMPLETED"; },
    failAll: () => { for (const r of requests.values()) if (r.status === "IN_QUEUE") Object.assign(r, { status: "FAILED", error: "fal could not write it" }); },
    failOne: (id) => Object.assign(requests.get(id), { status: "FAILED", error: "fal could not write it" }),
  };
}

async function setup() {
  const env = makeEnv({ FAL_KEY: "platform-key", WORKER_PUBLIC_URL: "https://studio.test" });
  const made = await createSeries(env, PID, { title: "The Last Lamp", prompt: "A cat relights a lighthouse.", aspectRatio: "16:9" });
  const seriesId = made.series.id;
  await updateSittings(env, PID, (db) => {
    db.kept = [{ id: "sit-1", seriesId, file: SITTING_FILE, seconds: CUE_SHEET_SECONDS, recordedAt: "2026-09-26T00:00:00Z" }];
    return {};
  });
  const job = { id: "film-1", prompt: "a cat saves a lighthouse", projectId: PID, userId: "u1", status: "running", auto: true, steps: [], spend: {} };
  // The sitting stage (#69) is faked: it hands over the kept film.
  const sittingStage = { key: "sitting", label: "Sitting", run: async () => ({ summary: "kept", result: { sittingId: "sit-1", seriesId, url: `/director-media/${SITTING_FILE}`, seconds: CUE_SHEET_SECONDS } }) };
  return { env, job, seriesId, sittingStage };
}

const model = { json: async () => ({ tags: ["warm strings", "celesta", "slow 70 BPM"] }) };

function stagesWith(sittingStage, deps) {
  return [sittingStage, { key: "score", label: "Score", paid: true, run: (ctx) => runScoreStage(ctx, deps) }];
}

describe("the Score stage", () => {
  it("is the last stage, a paid one", () => {
    expect(FILM_STAGES.at(-1)).toMatchObject({ key: "score", label: "Score", paid: true });
  });

  it("measures the film, renders the cue from the MEASURED length, mixes it under the picture, keeps the sitting", async () => {
    const { env, job: job0, seriesId, sittingStage } = await setup();
    const box = fakeScorer(env);
    const fal = fakeFal();
    const stages = stagesWith(sittingStage, { scorer: box.scorer, fetch: fal.fetch });
    const deps = { env, model, stages };

    let job = await advanceFilm(job0, deps); // the sitting
    job = await advanceFilm(job, deps); // score: measurement started
    let step = job.steps.at(-1);
    expect(step).toMatchObject({ key: "score", status: "running", pending: true });
    expect(box.scorer.startMeasure).toHaveBeenCalledWith(env, { filmKey: directorKey(PID, SITTING_FILE) });
    expect(fal.submits).toHaveLength(0);

    job = await advanceFilm(job, deps); // still measuring
    expect(job.steps.at(-1).pending).toBe(true);
    expect(box.scorer.startMeasure).toHaveBeenCalledTimes(1);

    await box.finish("measure");
    job = await advanceFilm(job, deps); // measured → cue submitted
    step = job.steps.at(-1);
    expect(step.pending).toBe(true);
    expect(step.result.measured).toMatchObject({ durationMs: 127400, hasAudio: true, videoCodec: "h264" });
    expect(step.result.measured.ducks).toEqual([[40, 44]]);
    expect(fal.submits).toHaveLength(1);
    expect(fal.submits[0].auth).toBe("Key platform-key");
    // The plan adds up to the FILM (2:07.4), not the cue sheet (2:00)…
    const chunks = fal.submits[0].body.composition_plan.chunks;
    expect(chunks.reduce((a, c) => a + c.duration_ms, 0)).toBe(127400);
    expect(planTotalMs(step.result.plan)).toBe(127400);
    // …and turns where the picture turns (31s, 64s, 95s — not the near-end cut).
    const starts = chunks.reduce((acc, c) => [...acc, acc.at(-1) + c.duration_ms], [0]).slice(1, -1);
    expect(starts).toEqual(expect.arrayContaining([31000, 64000, 96000]));
    expect(chunks[0].positive_styles).toEqual(expect.arrayContaining(["warm strings", "celesta"]));

    job = await advanceFilm(job, deps); // cue still in the queue
    expect(job.steps.at(-1).pending).toBe(true);
    expect(fal.submits).toHaveLength(1);
    expect(box.scorer.startMix).not.toHaveBeenCalled();

    fal.finish();
    job = await advanceFilm(job, deps); // cue filed → mix started
    step = job.steps.at(-1);
    expect(step.pending).toBe(true);
    expect(step.result.cue).toMatchObject({ status: "done", url: `/director-media/cue_${seriesId}_c1-request.mp3` });
    expect(await env.BUCKET.head(directorKey(PID, `cue_${seriesId}_c1-request.mp3`))).toBeTruthy();
    const mixSpec = box.scorer.startMix.mock.calls[0][1];
    expect(mixSpec).toMatchObject({
      filmKey: directorKey(PID, SITTING_FILE),
      cueKey: directorKey(PID, `cue_${seriesId}_c1-request.mp3`),
      durationMs: 127400,
      hasAudio: true,
      mix: { ducks: [[40, 44]], spans: [] },
    });

    await box.finish("mix");
    job = await advanceFilm(job, deps); // filed
    step = job.steps.at(-1);
    expect(step).toMatchObject({ key: "score", status: "done" });
    expect(job.status).toBe("done");
    expect(step.result.url).toMatch(/^\/director-media\/scored_sit-1_[0-9a-f]{8}\.mp4$/);
    expect(step.result.unscored).toEqual({ file: SITTING_FILE, url: `/director-media/${SITTING_FILE}` });
    expect(step.summary).toMatch(/Cue 2:07 in \d+ chunks/);

    // The scored film is filed BESIDE the sitting, which is kept as it was.
    const kept = (await readSittings(env, PID)).kept[0];
    expect(kept).toMatchObject({ id: "sit-1", file: SITTING_FILE, scoredFile: step.result.file, cueUrl: step.result.cue.url });
    // The cue is on the Series; the brief it was written in is now the standing one.
    const series = await readSeries(env, PID, seriesId);
    expect(series.audioPieces.find((p) => p.kind === "music")).toMatchObject({ audioUrl: step.result.cue.url, ducks: [[40, 44]] });
    expect(series.prompts.musicStyle).toBe("warm strings, celesta, slow 70 BPM");

    // Spend: two sandbox jobs and the cue at fal's per-minute price.
    expect(job.spend.score).toBeCloseTo(2 * FILM_RATES_USD.sandboxMinute + renderCostUsd(127400), 6);
  });

  it("a failed cue render throws; the retry renders it again", async () => {
    const { env, job: job0, sittingStage } = await setup();
    const box = fakeScorer(env);
    const fal = fakeFal();
    const deps = { env, model, stages: stagesWith(sittingStage, { scorer: box.scorer, fetch: fal.fetch }) };
    let job = await advanceFilm(job0, deps);
    job = await advanceFilm(job, deps);
    await box.finish("measure");
    job = await advanceFilm(job, deps);
    expect(fal.submits).toHaveLength(1);

    fal.failAll();
    job = await advanceFilm(job, deps);
    expect(job.steps.at(-1)).toMatchObject({ status: "retrying", failures: 1 });
    expect(job.steps.at(-1).error).toMatch(/cue render failed.*fal could not write it/);

    job = await advanceFilm(job, deps); // the retry submits a new render
    expect(fal.submits).toHaveLength(2);
    expect(job.steps.at(-1)).toMatchObject({ status: "running", pending: true });
    expect(box.scorer.startMeasure).toHaveBeenCalledTimes(1); // the measurement is kept

    fal.failAll();
    job = await advanceFilm(job, deps);
    expect(job.status).toBe("stopped");
    expect(job.stopped.stage).toBe("score");
  });

  it("a failed mix throws — twice stops the Film, the sitting untouched", async () => {
    const { env, job: job0, sittingStage } = await setup();
    const box = fakeScorer(env);
    const fal = fakeFal();
    const deps = { env, model, stages: stagesWith(sittingStage, { scorer: box.scorer, fetch: fal.fetch }) };
    let job = await advanceFilm(job0, deps);
    job = await advanceFilm(job, deps);
    await box.finish("measure");
    job = await advanceFilm(job, deps);
    fal.finish();
    job = await advanceFilm(job, deps);
    box.fail("mix", "exit 1\nInvalid data found");
    job = await advanceFilm(job, deps);
    expect(job.steps.at(-1)).toMatchObject({ status: "retrying" });
    expect(job.steps.at(-1).error).toMatch(/Mixing the cue under the film failed/);
    job = await advanceFilm(job, deps); // retry: a fresh mix, the cue is not re-rendered
    expect(box.scorer.startMix).toHaveBeenCalledTimes(2);
    expect(fal.submits).toHaveLength(1);
    box.fail("mix", "exit 1");
    job = await advanceFilm(job, deps);
    expect(job.status).toBe("stopped");
    const kept = (await readSittings(env, PID)).kept[0];
    expect(kept.file).toBe(SITTING_FILE);
    expect(kept.scoredFile).toBeUndefined();
  });

  it("the writing model writes the plan from the story on the measured clock — silences muted in the mix", async () => {
    const { env, job: job0, sittingStage } = await setup();
    const box = fakeScorer(env);
    const fal = fakeFal();
    const shots = [
      { id: "01", beat: "1", beatTitle: "The lamp is dark", dur: 30, location: "Lighthouse", action: "The cat climbs." },
      { id: "02", beat: "2", beatTitle: "The storm hits", dur: 30, location: "Gallery", action: "Waves smash the glass.", dialogue: "CAT: Hold on." },
      { id: "03", beat: "3", beatTitle: "The lamp relit", dur: 60, location: "Lamp room", action: "Light sweeps the sea." },
    ];
    const asked = [];
    const writer = {
      json: vi.fn(async (opts) => {
        const text = opts.messages.map((m) => m.content).join("\n");
        if (!/composition plan/.test(text)) return { tags: ["warm strings", "celesta"] };
        asked.push(text);
        return {
          chunks: [
            { section: "The lamp is dark", positive_styles: ["soft pads"], negative_styles: ["drums"], duration_ms: 30000 },
            { section: "Held breath", silence: true, positive_styles: ["near silence"], duration_ms: 8000 },
            { section: "The storm hits", positive_styles: ["taiko", "brass"], negative_styles: ["pads"], duration_ms: 25000 },
            { section: "Relit", positive_styles: ["soaring strings"], duration_ms: 58000 },
            { section: "End", positive_styles: ["final sustained chord"], duration_ms: 6000 },
          ],
        };
      }),
    };
    const stages = stagesWith(sittingStage, { scorer: box.scorer, fetch: fal.fetch, readShots: async () => shots });
    const deps = { env, model: writer, stages };
    let job = await advanceFilm(job0, deps);
    job = await advanceFilm(job, deps);
    await box.finish("measure");
    job = await advanceFilm(job, deps); // measured → the plan written → cue submitted
    let step = job.steps.at(-1);
    expect(step.result.planBy).toBe("writer");
    // The story on the MEASURED clock: 120 s planned → 127.4 s, so the storm
    // (30 s planned) scales to 31.85 s and snaps to the nearest real cut, 31.2 s
    // (0.65 s early, inside the 1 s allowance; the cut at 33.0 s is further).
    expect(step.result.moments.map((m) => m.title)).toEqual(["The lamp is dark", "The storm hits", "The lamp relit"]);
    expect(step.result.moments[1]).toMatchObject({ at: 31.2, planned: 30, snapped: true, dialogue: true });
    expect(step.result.measured.cuts).toHaveLength(5);
    expect(asked[0]).toContain("31.2s — The storm hits [dialogue]");
    expect(asked[0]).toContain("EXACTLY 127400");
    const chunks = fal.submits[0].body.composition_plan.chunks;
    expect(chunks.reduce((a, c) => a + c.duration_ms, 0)).toBe(127400);
    expect(chunks.map((c) => c.text)).toEqual(["[The lamp is dark]", "[Held breath]", "[The storm hits]", "[Relit]", "[End]"]);
    expect(chunks[0].positive_styles.slice(0, 2)).toEqual(["warm strings", "celesta"]);
    expect(step.result.silences).toHaveLength(1);
    const [silence] = step.result.silences;

    fal.finish();
    job = await advanceFilm(job, deps); // mix started — with the silence as a faded span
    const mixSpec = box.scorer.startMix.mock.calls[0][1];
    expect(mixSpec.mix.ducks).toEqual([[40, 44]]);
    expect(mixSpec.mix.spans).toEqual([{ from: silence.from, to: silence.to, db: -80, rampSec: 1.5 }]);

    await box.finish("mix");
    job = await advanceFilm(job, deps);
    step = job.steps.at(-1);
    expect(step.status).toBe("done");
    expect(step.summary).toMatch(/1 silence ·/);
    const kept = (await readSittings(env, PID)).kept[0];
    expect(kept.mix.spans).toEqual(mixSpec.mix.spans);
  });

  it("a writing model that fails falls back to the picture's plan — the Film is not failed", async () => {
    const { env, job: job0, sittingStage } = await setup();
    const box = fakeScorer(env);
    const fal = fakeFal();
    const broken = {
      json: async (opts) => {
        if (/composition plan/.test(opts.messages[0].content)) throw new Error("the model timed out");
        return { tags: ["warm strings"] };
      },
    };
    const deps = { env, model: broken, stages: stagesWith(sittingStage, { scorer: box.scorer, fetch: fal.fetch, readShots: async () => [] }) };
    let job = await advanceFilm(job0, deps);
    job = await advanceFilm(job, deps);
    await box.finish("measure");
    job = await advanceFilm(job, deps);
    const step = job.steps.at(-1);
    expect(step.status).toBe("running");
    expect(step.result.planBy).toBe("picture");
    expect(step.result.silences).toEqual([]);
    expect(fal.submits).toHaveLength(1);
    fal.finish();
    job = await advanceFilm(job, deps);
    expect(box.scorer.startMix.mock.calls[0][1].mix.spans).toEqual([]);
  });

  describe("from the Shot list's music cues", () => {
    // Written on the PLANNED clock (the Film plan's 120 s); the film runs 127.4 s.
    const MUSIC = [
      { startShot: 1, cue: "wonder", energy: 2, note: "the dark lamp", startSec: 0, shotId: "01" },
      { startShot: 8, cue: "whimsy", energy: 3, note: "the cat plays", startSec: 30, shotId: "08" },
      { startShot: 16, cue: "silence", energy: 1, note: "held breath", startSec: 60, shotId: "16" },
      { startShot: 18, cue: "action", energy: 5, note: "the storm", startSec: 66, shotId: "18" },
      { startShot: 24, cue: "triumph", energy: 4, note: "relit", startSec: 90, shotId: "24" },
    ];
    const withCues = (sittingStage, deps) => [
      { key: "shotlist", label: "Shot list", run: async () => ({ summary: "30 shots", result: { count: 30, seconds: 120, music: MUSIC } }) },
      ...stagesWith(sittingStage, deps),
    ];
    const noWriter = {
      json: vi.fn(async (opts) => {
        if (/composition plan/.test(opts.messages[0].content)) throw new Error("the cue path never asks for a plan");
        return { tags: ["warm strings", "celesta"] };
      }),
    };

    it("renders one piece per family run, polls them all, mixes N cues at their offsets", async () => {
      const { env, job: job0, seriesId, sittingStage } = await setup();
      const box = fakeScorer(env);
      const fal = fakeFal();
      const deps = { env, model: noWriter, stages: withCues(sittingStage, { scorer: box.scorer, fetch: fal.fetch }) };
      let job = await advanceFilm(job0, deps); // shot list
      job = await advanceFilm(job, deps); // sitting
      job = await advanceFilm(job, deps); // measure started
      await box.finish("measure");
      job = await advanceFilm(job, deps); // measured → pieces planned, all submitted
      let step = job.steps.at(-1);
      expect(step.result.planBy).toBe("cues");
      // On the measured clock: 30 s → 31.85 → the cut at 31.2; 60 → 63.7 → 64.1; 66 → 70.1 (no cut); 90 → 95.6.
      expect(step.result.cues.map((c) => [c.cue, c.at])).toEqual([
        ["wonder", 0], ["whimsy", 31.2], ["silence", 64.1], ["action", 70.1], ["triumph", 95.6],
      ]);
      expect(step.result.pieces.map((p) => [p.cues, p.startMs, p.lengthMs])).toEqual([
        [["wonder", "whimsy"], 0, 64_100], // into the silence: no overlap
        [["action"], 70_100, 26_500], // 1 s into Triumph, for the crossfade
        [["triumph"], 95_600, 31_800],
      ]);
      expect(fal.submits).toHaveLength(3);
      expect(fal.submits.every((x) => x.auth === "Key platform-key")).toBe(true);
      fal.submits.forEach((x, i) => {
        const plan = { chunks: x.body.composition_plan.chunks, seed: x.body.seed };
        expect(validatePlan(plan, step.result.pieces[i].lengthMs)).toEqual([]);
        expect(Number.isInteger(x.body.seed)).toBe(true);
      });
      expect(new Set(fal.submits.map((x) => x.body.seed)).size).toBe(3);
      expect(fal.submits[0].body.composition_plan.chunks.map((c) => c.text)).toEqual(["[Wonder]", "[Whimsy]"]);
      expect(noWriter.json.mock.calls.every(([o]) => !/composition plan/.test(o.messages[0].content))).toBe(true);
      expect(step.summary).toMatch(/Writing the score — 3 pieces, 0 of 3 done/);

      job = await advanceFilm(job, deps); // still in the queue — nothing re-sent
      expect(fal.submits).toHaveLength(3);
      expect(box.scorer.startMix).not.toHaveBeenCalled();

      fal.finish();
      job = await advanceFilm(job, deps); // every piece filed → the mix started
      step = job.steps.at(-1);
      expect(step.result.pieces.every((p) => p.render.status === "done")).toBe(true);
      expect(step.result.cue.url).toBe(`/director-media/cue_${seriesId}_c1-request.mp3`);
      const spec = box.scorer.startMix.mock.calls[0][1];
      expect(spec.cueKey).toBeUndefined();
      expect(spec.cues).toEqual([
        { key: directorKey(PID, `cue_${seriesId}_c1-request.mp3`), offsetMs: 0, durationMs: 64_100, fadeInSec: 1, fadeOutSec: 1.5 },
        { key: directorKey(PID, `cue_${seriesId}_c2-request.mp3`), offsetMs: 70_100, durationMs: 26_500, fadeInSec: 1.5, fadeOutSec: 1 },
        { key: directorKey(PID, `cue_${seriesId}_c3-request.mp3`), offsetMs: 95_600, durationMs: 31_800, fadeInSec: 1, fadeOutSec: 0 },
      ]);
      // The silence also mutes the bed, as a guarantee.
      expect(spec.mix.spans).toEqual([{ from: 64.1, to: 70.1, db: -80, rampSec: 1.5 }]);
      expect(spec.mix.ducks).toEqual([[40, 44]]);
      // …and the real ffmpeg command takes the three pieces.
      const script = mixJobScript({ WORKER_PUBLIC_URL: "https://studio.test", INGEST_TOKEN: "t" }, spec);
      expect(script).toContain("adelay=delays=70100:all=1");
      expect(script).toContain("amix=inputs=3:duration=longest:normalize=0");

      await box.finish("mix");
      job = await advanceFilm(job, deps);
      step = job.steps.at(-1);
      expect(step.status).toBe("done");
      expect(step.summary).toBe("3 pieces: Wonder → Whimsy | silence | Action | Triumph · 1 silence · scored film filed beside the sitting");
      const kept = (await readSittings(env, PID)).kept[0];
      expect(kept.scoredFile).toBe(step.result.file);
      expect(kept.cueUrl).toBe(step.result.cue.url);
      expect(kept.cuePieces.map((p) => [p.url, p.offsetMs, p.cues])).toEqual(
        step.result.pieces.map((p) => [p.render.url, p.startMs, p.cues]),
      );
      const series = await readSeries(env, PID, seriesId);
      const filed = series.audioPieces.filter((p) => p.kind === "music");
      expect(filed).toHaveLength(3);
      expect(filed.find((p) => p.audioUrl === step.result.pieces[1].render.url).offset).toBe(70.1);
      // Spend: two sandbox jobs and each piece at fal's per-minute price.
      expect(job.spend.score).toBeCloseTo(
        2 * FILM_RATES_USD.sandboxMinute + renderCostUsd(64_100) + renderCostUsd(26_500) + renderCostUsd(31_800), 6,
      );
    });

    it("a failed piece throws; the retry re-renders only that piece", async () => {
      const { env, job: job0, sittingStage } = await setup();
      const box = fakeScorer(env);
      const fal = fakeFal();
      const deps = { env, model: noWriter, stages: withCues(sittingStage, { scorer: box.scorer, fetch: fal.fetch }) };
      let job = await advanceFilm(job0, deps);
      job = await advanceFilm(job, deps);
      job = await advanceFilm(job, deps);
      await box.finish("measure");
      job = await advanceFilm(job, deps);
      expect(fal.submits).toHaveLength(3);

      fal.failOne("c2-request");
      job = await advanceFilm(job, deps);
      expect(job.steps.at(-1)).toMatchObject({ status: "retrying", failures: 1 });
      expect(job.steps.at(-1).error).toMatch(/Piece 2 of the score failed \(request c2-request\)/);

      fal.finish(); // the other two finish meanwhile
      job = await advanceFilm(job, deps); // the retry: piece 2 sent again, alone
      expect(fal.submits).toHaveLength(4);
      expect(fal.submits[3].body.composition_plan.chunks.map((c) => c.text)).toEqual(["[Action]"]);
      const pieces = job.steps.at(-1).result.pieces;
      expect(pieces.map((p) => p.render.status)).toEqual(["done", "running", "done"]);
      expect(pieces[1].render).toMatchObject({ requestId: "c4-request", attempt: 2 });

      fal.finish();
      job = await advanceFilm(job, deps);
      expect(box.scorer.startMix).toHaveBeenCalledTimes(1);
      await box.finish("mix");
      job = await advanceFilm(job, deps);
      expect(job.status).toBe("done");
    });
  });

  it("throws without a kept sitting", async () => {
    const { env, job } = await setup();
    await expect(runScoreStage({ job, results: {}, env }, { scorer: fakeScorer(env).scorer, fetch: fakeFal().fetch }))
      .rejects.toThrow(/no kept sitting/);
  });
});

describe("the server-side mix", () => {
  it("reads ffprobe, the scene cuts and the loudness row", () => {
    const m = parseMeasurement(measurementStdout());
    expect(m.durationMs).toBe(127400);
    expect(m.cuts).toHaveLength(5);
    expect(m.cuts[2]).toEqual({ at: 64.1, score: 0.88 });
    expect(m.loudness).toHaveLength(127);
    expect(parseMeasurement(measurementStdout({ audio: false })).hasAudio).toBe(false);
    expect(() => parseMeasurement("@@PROBE\n{}\n@@SCENE\n@@RMS\n@@END")).toThrow(/no duration/);
  });

  it("keeps the hardest cuts, spaced, clear of the ending", () => {
    expect(pickTurns(parseMeasurement(measurementStdout()).cuts, 127400)).toEqual([31, 64, 96]);
  });

  it("copies the picture, lays the bed under the film's own audio, AAC, faststart", () => {
    const args = mixArgs({ film: "f.mp4", cue: "c.mp3", out: "o.mp4", durationMs: 127400, hasAudio: true, mix: { ducks: [[40, 44]] } });
    const at = (flag) => args[args.indexOf(flag) + 1];
    expect(at("-c:v")).toBe("copy");
    expect(at("-c:a")).toBe("aac");
    expect(at("-movflags")).toBe("+faststart");
    expect(at("-t")).toBe("127.400");
    const graph = at("-filter_complex");
    expect(graph).toContain("afade=t=in:st=0:d=1");
    expect(graph).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(graph).toContain(bedVolumeExpression({ ...DEFAULT_MIX, ducks: [[40, 44]] }));
    expect(bedVolumeExpression({ ...DEFAULT_MIX, ducks: [[40, 44]] })).toBe("0.089*if(between(t,40,44),0.596,1)");
    // A silent sitting: the bed alone.
    const silent = mixArgs({ film: "f", cue: "c", out: "o", durationMs: 5000, hasAudio: false, mix: {} });
    expect(silent[silent.indexOf("-filter_complex") + 1]).not.toContain("amix");
    // A VP8 WebM sitting stays WebM (Opus), still stream-copied.
    const webm = mixArgs({ film: "f", cue: "c", out: "o.webm", durationMs: 5000, hasAudio: true, mix: {} });
    expect(webm[webm.indexOf("-c:v") + 1]).toBe("copy");
    expect(webm[webm.indexOf("-c:a") + 1]).toBe("libopus");
    expect(webm).not.toContain("-movflags");
    // A scored film is always an mp4: a VP8/VP9 picture is re-encoded to H.264
    // (Safari / iOS can't decode VP9 in an mp4); H.264 is still copied.
    expect(scoredName("s1")).toMatch(/\.mp4$/);
    const vp9 = mixArgs({ film: "f", cue: "c", out: "o.mp4", durationMs: 5000, hasAudio: true, mix: {}, videoCodec: "vp9" });
    expect(vp9[vp9.indexOf("-c:v") + 1]).toBe("libx264");
    const h264 = mixArgs({ film: "f", cue: "c", out: "o.mp4", durationMs: 5000, hasAudio: true, mix: {}, videoCodec: "h264" });
    expect(h264[h264.indexOf("-c:v") + 1]).toBe("copy");
  });

  it("the detached mix downloads through /files and uploads through /ingest", () => {
    const env = { WORKER_PUBLIC_URL: "https://studio.test", INGEST_TOKEN: "tok" };
    const script = mixJobScript(env, {
      filmKey: "media/p1/director/sitting.mp4", cueKey: "media/p1/director/cue.mp3", outKey: "media/p1/director/scored_s1_x.mp4",
      durationMs: 5000, hasAudio: true, mix: {},
    });
    expect(script).toContain("'https://studio.test/files/media/p1/director/sitting.mp4'");
    expect(script).toContain("'https://studio.test/files/media/p1/director/cue.mp3'");
    expect(script).toMatch(/upload_r2 \S+scored\.mp4 'media\/p1\/director\/scored_s1_x\.mp4'/);
    expect(script).toContain("'-c:v' 'copy'");
  });
});
