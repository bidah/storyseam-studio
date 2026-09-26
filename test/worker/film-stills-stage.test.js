// The Film job's "Stills" stage (#68): each drawn clip cut by a sandbox job at
// its sheet's own grab times, then every frame pinned through the Director's
// helpers — against a FAKE cutter (no Daytona) on a real in-memory D1 and R2.
// The Film comes through the real sheets → shotlist → cuesheet → run stages,
// so the stills pin the cue sheet the job actually wrote.
import { describe, it, expect, vi } from "vitest";
import { makeEnv } from "./_fakes.js";
import { FILM_STAGES } from "../../worker/src/lib/film-job.js";
import { runSheetsStage } from "../../worker/src/lib/film-stages/sheets.js";
import { runShotlistStage } from "../../worker/src/lib/film-stages/shotlist.js";
import { runCueSheetStage } from "../../worker/src/lib/film-stages/cuesheet.js";
import { runRunStage } from "../../worker/src/lib/film-stages/run.js";
import { cutScript, pinFile, runStillsStage } from "../../worker/src/lib/film-stages/stills.js";
import { saveWorld } from "../../worker/src/routes/world.js";
import { patchSeries, pinBeat, readSeries, readSheets } from "../../worker/src/lib/director.js";
import { grabTimes } from "../../worker/src/lib/shot-sheet.ts";

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
const SHOTS = {
  shots: Array.from({ length: 20 }, (_, i) => ({
    beat: "B1", beatTitle: "Night", location: "lamp-room", dur: 4, characters: ["Mote"],
    camera: "Wide", action: `Shot ${i + 1}: Mote climbs.`, dialogue: "(no dialogue)",
    audioSync: "wind", prompt: `Mote climbs, shot ${i + 1}.`,
  })),
};
const model = {
  json: async ({ messages }) => (messages[0].content.includes("art department") ? SHEETS_ANSWER : SHOTS),
};
const imageFal = {
  submit: async () => ({ requestId: `img-${Math.random().toString(36).slice(2)}` }),
  poll: async (_k, _e, id) => ({ done: true, url: `https://v3.fal.media/files/${id}.png` }),
};
const imageFetch = async () => new Response(new Uint8Array([137, 80, 78, 71]));

// fal's queue, every clip completing on its first poll.
function falDone() {
  let n = 0;
  return async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://v3.fal.media/")) return new Response(new Uint8Array([0, 0, 0, 24]));
    const m = /^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/]+)(\/status)?$/.exec(u);
    if (m) {
      if (m[3]) return Response.json({ status: "COMPLETED" });
      return Response.json({ video: { url: `https://v3.fal.media/files/${m[2]}.mp4` } });
    }
    JSON.parse(init.body);
    n += 1;
    return Response.json({ request_id: `clip-${n}` });
  };
}

/** A Film through the shot sheet run, every clip drawn. */
async function filmAt(prompt) {
  const env = makeEnv({
    FAL_KEY: "platform-key", WORKER_PUBLIC_URL: "https://studio.test", INGEST_TOKEN: "tok", DAYTONA_API_KEY: "dt",
  });
  await saveWorld(env, PID, { ...WORLD, source: "auto" });
  const job = { id: "film-1", prompt, projectId: PID, userId: "u1", steps: [] };
  const results = { world: { idea: "A cat relights the lamp.", title: WORLD.title } };
  const sheets = await runSheetsStage({ job, results, env, model }, { fal: imageFal, fetch: imageFetch, sleep: async () => {} });
  await runShotlistStage({ job, results, env, model });
  const cuesheet = await runCueSheetStage({ job, results: { ...results, sheets: sheets.result }, env });
  const all = { ...results, sheets: sheets.result, cuesheet: cuesheet.result };
  const fetch = falDone();
  await runRunStage({ job, results: all, env }, { fetch });
  const run = await runRunStage({ job, results: all, env }, { fetch });
  expect(run.pending).toBeUndefined();
  return { env, job, results: { ...all, run: run.result } };
}

/**
 * A Daytona stand-in. `start` records the spec; `finish()` completes every
 * running cut by writing a PNG at each frame's key (what the sandbox's
 * /ingest PUT does); `fail(jobId)` makes that cut exit non-zero.
 */
function fakeCutter(env) {
  const jobs = new Map();
  let n = 0;
  return {
    specs: [],
    jobs,
    start: vi.fn(async function (_env, spec) {
      const id = `j${++n}`;
      this.specs.push(spec);
      jobs.set(id, { status: "running", spec });
      return id;
    }),
    poll: vi.fn(async (_env, id) => {
      const j = jobs.get(id);
      return { status: j.status, error: j.error || null };
    }),
    async finish() {
      for (const j of jobs.values()) {
        if (j.status !== "running") continue;
        for (const f of j.spec.frames) await env.BUCKET.put(f.key, new Uint8Array([137, 80, 78, 71]), { httpMetadata: { contentType: "image/png" } });
        j.status = "done";
      }
    },
    fail(id) { Object.assign(jobs.get(id), { status: "error", error: "exit 1\nffmpeg: moov atom not found" }); },
  };
}

/** Run the stage the way the job does: the step's last result rides on `job.steps`. */
function stepper(job, results, env, deps) {
  let result = null;
  let attempt = 1;
  return {
    retry() { attempt += 1; },
    async call() {
      const stepJob = { ...job, steps: [{ key: "stills", result }] };
      const out = await runStillsStage({ job: stepJob, results, env, attempt }, deps);
      result = out.result;
      return out;
    },
  };
}

describe("the Stills stage", () => {
  it("comes right after the shot sheet run", () => {
    const keys = FILM_STAGES.map((s) => s.key);
    expect(keys.indexOf("stills")).toBe(keys.indexOf("run") + 1);
    expect(FILM_STAGES.find((s) => s.key === "stills")).toMatchObject({ label: "Stills" });
  });

  it("pending while the sandbox cuts; then the opening frame is the Series' first frame and every pin lands, in offset order", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    const cutter = fakeCutter(env);
    const pinned = [];
    const patched = [];
    const deps = {
      cutter,
      pinBeat: async (...args) => { pinned.push(args[3].offset); return pinBeat(...args); },
      patchSeries: async (...args) => { patched.push(args[3]); return patchSeries(...args); },
    };
    const s = stepper(job, results, env, deps);

    const first = await s.call();
    expect(first.pending).toBe(true);
    expect(first.summary).toMatch(/^Cutting stills — 0 of \d clips? cut$/);
    expect(cutter.start).toHaveBeenCalledTimes(results.run.clips.length);
    expect(pinned).toEqual([]);

    // One cut per clip, at exactly its take's grab times, to the pins route's keys.
    const ledger = await readSheets(env, PID);
    for (const [i, clip] of results.run.clips.entries()) {
      const take = ledger.takes.find((t) => t.id === clip.takeId);
      const spec = cutter.specs[i];
      expect(spec.videoUrl).toBe(`https://studio.test/files/media/p1/director/${take.file}`);
      expect(spec.frames.map((f) => f.at)).toEqual(grabTimes(take.sheet));
      expect(spec.frames.map((f) => f.key)).toEqual(
        take.sheet.shots.map((sh) => `media/p1/director/${pinFile(results.run.seriesId, sh.offset, take.id)}`),
      );
    }

    // Still cutting: polled, nothing started twice, nothing pinned.
    const again = await s.call();
    expect(again.pending).toBe(true);
    expect(cutter.start).toHaveBeenCalledTimes(results.run.clips.length);
    expect(pinned).toEqual([]);

    await cutter.finish();
    const done = await s.call();
    expect(done.pending).toBeUndefined();

    const offsets = results.run.clips.flatMap((c) => c.offsets);
    const pinOffsets = offsets.filter((o) => o > 0).sort((a, b) => a - b);
    expect(pinned).toEqual(pinOffsets); // one at a time, in offset order
    expect(patched).toHaveLength(1);

    const series = await readSeries(env, PID, results.run.seriesId);
    const openingTake = ledger.takes.find((t) => t.id === results.run.clips[0].takeId);
    expect(series.imageUrl).toBe(`/director-media/${pinFile(series.id, 0, openingTake.id)}`);
    for (const o of pinOffsets) {
      const beat = series.directions.find((b) => b.offset === o);
      expect(beat.endImageUrl).toMatch(new RegExp(`^/director-media/pin_${series.id}_${o}s_clip-\\d+\\.png$`));
    }

    expect(done.result.firstFrame).toBe(series.imageUrl);
    expect(done.result.frames.map((f) => f.offset)).toEqual([0, ...pinOffsets]);
    expect(done.summary).toBe(`${pinOffsets.length} frames pinned · first frame set`);
  });

  it("a cut the sandbox fails throws; the retry re-cuts only that clip", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    expect(results.run.clips.length).toBeGreaterThan(1);
    const cutter = fakeCutter(env);
    const s = stepper(job, results, env, { cutter });

    await s.call();
    cutter.fail("j2");
    const err = await s.call().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Clip 2 of \d: the frame cut failed — exit 1/);

    s.retry();
    const retry = await s.call();
    expect(retry.pending).toBe(true);
    expect(cutter.start).toHaveBeenCalledTimes(results.run.clips.length + 1);
    expect(retry.result.cuts.find((c) => c.part === 2)).toMatchObject({ jobId: `j${results.run.clips.length + 1}`, attempt: 2 });

    await cutter.finish();
    const done = await s.call();
    expect(done.pending).toBeUndefined();
  });

  it("a cut that finishes without its frames throws before anything is pinned", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    const cutter = fakeCutter(env);
    const pinned = [];
    const s = stepper(job, results, env, { cutter, pinBeat: async (...a) => { pinned.push(a); return pinBeat(...a); } });
    await s.call();
    for (const j of cutter.jobs.values()) j.status = "done"; // exit 0, nothing uploaded
    await expect(s.call()).rejects.toThrow(/the cut uploaded no frame/);
    expect(pinned).toEqual([]);
  });

  it("refuses to run without the platform Daytona key", async () => {
    const env = makeEnv({ WORKER_PUBLIC_URL: "https://studio.test", INGEST_TOKEN: "t" });
    const job = { id: "film-1", projectId: PID, steps: [] };
    await expect(runStillsStage({ job, results: { run: { seriesId: "s_1", clips: [] } }, env })).rejects.toThrow(/DAYTONA_API_KEY/);
  });

  it("the sandbox script keeps the frame on screen at each grab time and PUTs it to its key", () => {
    const env = { WORKER_PUBLIC_URL: "https://studio.test/", INGEST_TOKEN: "tok" };
    const script = cutScript(env, {
      videoUrl: "https://studio.test/files/media/p1/director/take.mp4",
      frames: [{ at: 0.5, key: "media/p1/director/a.png" }, { at: 7.5, key: "media/p1/director/b.png" }],
    });
    expect(script).toContain("curl -fsS -o in.mp4 'https://studio.test/files/media/p1/director/take.mp4'");
    // 0.5s: seek to 0, keep the last frame ≤ 0.5s.
    expect(script).toContain("-ss 0.000000 -t 1.000000 -i in.mp4 -vf 'select=lte(t\\,0.500000)'");
    // 7.5s: seek to 5.5, keep the last frame ≤ 2s into the seek.
    expect(script).toContain("-ss 5.500000 -t 2.500000 -i in.mp4 -vf 'select=lte(t\\,2.000000)'");
    expect(script).toContain("-T f1.png 'https://studio.test/ingest/media/p1/director/b.png'");
    expect(script).toContain("'authorization: Bearer tok'");
  });
});
