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
import { planTotalMs, renderCostUsd } from "../../worker/src/lib/music-plan.ts";
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
    const m = /^https:\/\/queue\.fal\.run\/elevenlabs\/music\/v2\.5\/requests\/([^/]+)(\/status)?$/.exec(u);
    if (m) {
      const req = requests.get(m[1]);
      if (m[2]) return Response.json({ status: req.status, ...(req.error ? { error: req.error } : {}) });
      return Response.json({ audio: { url: `https://v3.fal.media/files/${m[1]}.mp3`, duration: FILM_SECONDS } });
    }
    if (u !== "https://queue.fal.run/elevenlabs/music/v2.5") throw new Error(`unexpected fetch ${u}`);
    const id = `cue-request-${++n}`;
    submits.push({ body: JSON.parse(init.body), auth: init.headers.authorization, id });
    requests.set(id, { status: "IN_QUEUE" });
    return Response.json({ request_id: id });
  });
  return {
    fetch,
    submits,
    finish: () => { for (const r of requests.values()) if (r.status === "IN_QUEUE") r.status = "COMPLETED"; },
    failAll: () => { for (const r of requests.values()) if (r.status === "IN_QUEUE") Object.assign(r, { status: "FAILED", error: "fal could not write it" }); },
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
    expect(step.result.cue).toMatchObject({ status: "done", url: `/director-media/cue_${seriesId}_cue-request-1.mp3` });
    expect(await env.BUCKET.head(directorKey(PID, `cue_${seriesId}_cue-request-1.mp3`))).toBeTruthy();
    const mixSpec = box.scorer.startMix.mock.calls[0][1];
    expect(mixSpec).toMatchObject({
      filmKey: directorKey(PID, SITTING_FILE),
      cueKey: directorKey(PID, `cue_${seriesId}_cue-request-1.mp3`),
      durationMs: 127400,
      hasAudio: true,
      mix: { ducks: [[40, 44]] },
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
    expect(scoredName("s1", "vp8")).toMatch(/\.webm$/);
    expect(scoredName("s1", "h264")).toMatch(/\.mp4$/);
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
