// The Film job's "Shot sheet run" stage (#67): the Reel planner's plan, one
// clip per Reel on the platform fal key, polled to completion across calls —
// against a FAKE fal queue, on a real in-memory D1 and R2. The Series comes
// from the real sheets → shotlist → cuesheet stages, so the run draws the cue
// sheet the job actually wrote.
import { describe, it, expect, vi } from "vitest";
import { makeEnv } from "./_fakes.js";
import { advanceFilm, FILM_STAGES, nextAlarmDelay, PENDING_POLL_MS } from "../../worker/src/lib/film-job.js";
import { runSheetsStage } from "../../worker/src/lib/film-stages/sheets.js";
import { runShotlistStage } from "../../worker/src/lib/film-stages/shotlist.js";
import { runCueSheetStage } from "../../worker/src/lib/film-stages/cuesheet.js";
import { clipSpend, runRunStage } from "../../worker/src/lib/film-stages/run.js";
import { saveWorld } from "../../worker/src/routes/world.js";
import { readSeries, readSheets, replaceCueSheet } from "../../worker/src/lib/director.js";
import { planFilm } from "../../worker/src/lib/film-plan.ts";
import { MIN_END_IMAGE_GAP_SECONDS, MIN_OPENING_END_IMAGE_SECONDS } from "../../worker/src/lib/series.ts";

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
  submit: async (_k, _e, _i) => ({ requestId: `img-${Math.random().toString(36).slice(2)}` }),
  poll: async (_k, _e, id) => ({ done: true, url: `https://v3.fal.media/files/${id}.png` }),
};
const imageFetch = async () => new Response(new Uint8Array([137, 80, 78, 71]));

/** A Film through the cue sheet, ready for the run. */
async function filmAt(prompt) {
  // WORKER_PUBLIC_URL: references are absolutized for fal to fetch.
  const env = makeEnv({ FAL_KEY: "platform-key", WORKER_PUBLIC_URL: "https://studio.test" });
  await saveWorld(env, PID, { ...WORLD, source: "auto" });
  const job = { id: "film-1", prompt, projectId: PID, userId: "u1", steps: [] };
  const results = { world: { idea: "A cat relights the lamp.", title: WORLD.title } };
  const sheets = await runSheetsStage({ job, results, env, model }, { fal: imageFal, fetch: imageFetch, sleep: async () => {} });
  await runShotlistStage({ job, results, env, model });
  const cuesheet = await runCueSheetStage({ job, results: { ...results, sheets: sheets.result }, env });
  return { env, job, results: { ...results, sheets: sheets.result, cuesheet: cuesheet.result } };
}

/**
 * fal's queue, faked at `fetch`. Every submit is queued IN_QUEUE; `finish()`
 * completes everything queued so far; `refuseSubmit(n)` refuses the nth submit;
 * `failRender(id)` makes that request FAILED.
 */
function fakeFal() {
  const requests = new Map(); // id -> { status, endpoint, body, auth }
  const submits = [];
  let n = 0;
  const refusals = new Set();
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://v3.fal.media/")) return new Response(new Uint8Array([0, 0, 0, 24]));
    const m = /^https:\/\/queue\.fal\.run\/(.+?)\/requests\/([^/]+)(\/status)?$/.exec(u);
    if (m) {
      const req = requests.get(m[2]);
      if (m[3]) return Response.json({ status: req.status, ...(req.error ? { error: req.error } : {}) });
      return Response.json({ video: { url: `https://v3.fal.media/files/${m[2]}.mp4` } });
    }
    n += 1;
    const body = JSON.parse(init.body);
    submits.push({ url: u, body, auth: init.headers.authorization });
    if (refusals.has(n)) return Response.json({ detail: "content policy" }, { status: 422 });
    const id = `clip-${n}`;
    requests.set(id, { status: "IN_QUEUE" });
    return Response.json({ request_id: id });
  });
  return {
    fetch,
    submits,
    finish: () => { for (const r of requests.values()) if (r.status !== "FAILED") r.status = "COMPLETED"; },
    refuseSubmit: (k) => refusals.add(k),
    failRender: (id) => Object.assign(requests.get(id), { status: "FAILED", error: "fal could not draw it" }),
  };
}

/** Every clip's frames obey the Series' per-reel pin rules. */
function expectPinnable(result) {
  for (const clip of result.clips) {
    const pins = clip.offsets.filter((o) => o > 0);
    for (const [i, o] of pins.entries()) {
      expect(o - clip.opensAt).toBeGreaterThanOrEqual(MIN_OPENING_END_IMAGE_SECONDS);
      if (i) expect(o - pins[i - 1]).toBeGreaterThanOrEqual(MIN_END_IMAGE_GAP_SECONDS);
    }
    expect(pins.length).toBeLessThanOrEqual(16);
  }
  // No frame a seam costs is drawn.
  const drawn = new Set(result.clips.flatMap((c) => c.offsets));
  for (const s of result.plan.skipped) expect(drawn.has(s.offset)).toBe(false);
}

describe("the Shot sheet run stage", () => {
  it("is appended after the cue sheet, a paid stage", () => {
    expect(FILM_STAGES.find((s) => s.key === "run")).toMatchObject({ label: "Shot sheet run", paid: true });
    expect(FILM_STAGES.map((s) => s.key).indexOf("run")).toBe(FILM_STAGES.map((s) => s.key).indexOf("cuesheet") + 1);
  });

  // A Film is 2:00 by default, which at a pin every 4s is two reels by the Film
  // plan's own count — so the one-reel run is a cue sheet cut to its first 48s.
  it("one reel → one clip on the platform key, pending until fal finishes", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    const series0 = await readSeries(env, PID, results.sheets.seriesId);
    await replaceCueSheet(env, PID, series0.id, series0.directions.slice(0, 12));
    const fal = fakeFal();

    const first = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(first.pending).toBe(true);
    expect(first.result.plan.reels).toHaveLength(1);
    expect(first.result.plan.seams).toEqual([]);
    expect(first.result.clips).toHaveLength(1);
    expect(first.result.clips[0]).toMatchObject({ part: 1, reel: 1, opensAt: 0, status: "running", takeId: "clip-1", videoUrl: null });
    expect(fal.submits).toHaveLength(1);
    expect(fal.submits[0].auth).toBe("Key platform-key");
    expect(fal.submits[0].url).toMatch(/reference-to-video$/);
    // The Series' model sheets went as references.
    const refs = fal.submits[0].body.reference_image_urls;
    expect(refs).toHaveLength(3); // style, Mote, Lamp room
    for (const url of refs) expect(url).toMatch(/^https:\/\/studio\.test\/files\/media\/p1\/director\/auto-film-1-/);
    expect(first.spend).toBe(clipSpend({ duration: 15 }));
    expect(first.summary).toBe("1 reel · 0 seams · 0 frames skipped · 0 of 1 clip drawn");
    expectPinnable(first.result);

    // Still rendering: a second call submits nothing and pays nothing.
    const again = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(again.pending).toBe(true);
    expect(again.spend).toBe(0);
    expect(fal.submits).toHaveLength(1);

    fal.finish();
    const done = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(done.pending).toBeUndefined();
    expect(done.result.clips[0]).toMatchObject({ status: "done", takeId: "clip-1" });
    expect(done.result.clips[0].videoUrl).toMatch(/^\/director-media\/shot-sheet_.+_clip-1\.mp4$/);
    expect(done.summary).toMatch(/1 of 1 clip drawn$/);

    // Filed in the ledger (tagged with the Film) and as the run's style sheet.
    const ledger = await readSheets(env, PID);
    expect(ledger.takes).toHaveLength(1);
    expect(ledger.takes[0]).toMatchObject({ filmId: "film-1", runId: done.result.runId, part: 1, parts: 1, status: "done" });
    const series = await readSeries(env, PID, results.sheets.seriesId);
    // A Film's take is NOT filed back as a style sheet: its references are the
    // sheets the Sheets stage drew, and a filed take is an mp4 on that list.
    expect(series.modelSheets.filter((s) => s.name.startsWith("shot sheet"))).toHaveLength(0);
    expect(series.reelChanges || []).toEqual([]);
  });

  it.each([
    ["a cat saves a lighthouse", 2], // 2:00
    ["a three minute film", 3],
    ["a four and a half minute epic", 4], // 5s spacing
  ])("%j → the Film plan's reels, one clip per reel, the seams written on the Series", async (prompt, expected) => {
    const { env, job, results } = await filmAt(prompt);
    const plan = planFilm({ prompt });
    const fal = fakeFal();

    const first = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    const reels = first.result.plan.reels.length;
    expect(reels).toBe(plan.reels);
    expect(reels).toBe(expected);
    // The run draws exactly the pins the plan quoted (#71: the plan used to
    // count one more, at the Film's very last second, which is no beat).
    expect(first.result.clips.flatMap((c) => c.offsets).filter((o) => o > 0)).toHaveLength(plan.pins);
    expect(first.result.clips).toHaveLength(reels);
    expect(fal.submits).toHaveLength(reels);
    expect(first.result.clips.map((c) => c.opensAt)).toEqual([0, ...first.result.plan.seams]);
    expect(first.spend).toBeCloseTo(reels * clipSpend({ duration: 15 }));
    expectPinnable(first.result);

    const series = await readSeries(env, PID, results.sheets.seriesId);
    expect(series.reelChanges).toEqual(first.result.plan.seams);

    fal.finish();
    const done = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(done.pending).toBeUndefined();
    expect(done.result.clips.every((c) => c.status === "done" && c.videoUrl)).toBe(true);
    expect(fal.submits).toHaveLength(reels); // nothing paid twice
    // No clip of a Film's run is filed back as a style sheet.
    const after = await readSeries(env, PID, results.sheets.seriesId);
    expect(after.modelSheets.filter((s) => s.name.startsWith("shot sheet"))).toHaveLength(0);
  });

  it("a clip fal refuses throws; the retry re-submits only that clip", async () => {
    const { env, job, results } = await filmAt("a four and a half minute epic");
    const fal = fakeFal();
    fal.refuseSubmit(3);

    const err = await runRunStage({ job, results, env }, { fetch: fal.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Clip 3 of 4: content policy/);
    expect(err.spend).toBeCloseTo(2 * clipSpend({ duration: 15 })); // the two already queued

    const retry = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(retry.pending).toBe(true);
    expect(fal.submits).toHaveLength(3 + 2); // clips 3 and 4, again
    expect(retry.result.clips.map((c) => c.takeId)).toEqual(["clip-1", "clip-2", "clip-4", "clip-5"]);
    expect(new Set(retry.result.clips.map((c) => c.status))).toEqual(new Set(["running"]));
  });

  it("a clip that FAILS on the queue throws", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    const fal = fakeFal();
    await runRunStage({ job, results, env }, { fetch: fal.fetch });
    fal.failRender("clip-2");
    await expect(runRunStage({ job, results, env }, { fetch: fal.fetch })).rejects.toThrow(/^Clip 2 of 2: fal could not draw it/);
    // The retry re-submits the failed clip only.
    const retry = await runRunStage({ job, results, env }, { fetch: fal.fetch });
    expect(retry.result.clips.map((c) => c.takeId)).toEqual(["clip-1", "clip-3"]);
  });

  it("refuses to draw without the platform fal key", async () => {
    const { env, job, results } = await filmAt("a cat saves a lighthouse");
    delete env.FAL_KEY;
    await expect(runRunStage({ job, results, env }, { fetch: fakeFal().fetch })).rejects.toThrow(/FAL_KEY/);
  });
});

describe("the runner and a pending stage", () => {
  const job0 = () => ({ id: "f", prompt: "p", status: "running", projectId: PID, userId: "u", steps: [], spend: {} });

  it("keeps the step running across calls, counts its spend, and does not use up the retry", async () => {
    let calls = 0;
    const stages = [{
      key: "run", label: "Shot sheet run",
      run: async () => {
        calls += 1;
        if (calls === 1) return { pending: true, summary: "0 of 1", result: { n: 0 }, spend: 0.75 };
        if (calls === 2) return { pending: true, summary: "0 of 1", result: { n: 0 } };
        if (calls === 3) throw new Error("flaky");
        return { summary: "1 of 1", result: { n: 1 } };
      },
    }];
    const events = [];
    const deps = { stages, commit: async (_j, ev) => events.push(ev.kind) };

    let job = await advanceFilm(job0(), deps);
    expect(job.status).toBe("running");
    expect(job.steps[0]).toMatchObject({ status: "running", pending: true, summary: "0 of 1", failures: 0 });
    expect(job.spend.run).toBe(0.75);
    expect(nextAlarmDelay(job)).toBe(PENDING_POLL_MS);

    job = await advanceFilm(job, deps); // unchanged progress: no event
    job = await advanceFilm(job, deps); // throws → retrying
    expect(job.steps[0]).toMatchObject({ status: "retrying", pending: false, failures: 1 });
    expect(nextAlarmDelay(job)).toBe(0);
    job = await advanceFilm(job, deps);
    expect(job.status).toBe("done");
    expect(job.steps[0]).toMatchObject({ status: "done", pending: false, summary: "1 of 1", result: { n: 1 } });
    expect(events).toEqual(["step.started", "step.progress", "step.retrying", "step.done", "film.done"]);
  });
});
