// The Film job's "Stills" stage (Auto, PRD #59 / #68).
//
// The Shot sheet tab cuts a take in the BROWSER (routes/shotsheet.jsx
// `CutTake`): mediabunny decodes the clip, grabs a frame at each of the
// sheet's grab times, `POST /api/shotsheet/pins` files them, and the page pins
// them one at a time through the Director. Auto has no browser (ADR 0001), so
// this stage does the same on the server:
//
//   1. For each drawn clip, a DETACHED Daytona job (the ffmpeg sandbox and the
//      `jobs` table — lib/ffmpeg.js `getSandbox`, lib/jobs.js, exactly as the
//      Musical split and the Deliver render run) downloads the take from
//      `/files/…`, grabs one PNG at each `grabTimes(take.sheet)` second, and
//      PUTs it back through `/ingest/…` to the SAME key the pins route writes
//      (`media/<pid>/director/pin_<series>_<offset>s_<take>.png`).
//   2. When every clip's cut has finished, the Worker checks each frame landed
//      and pins them through the Director's own helpers (lib/director.js
//      `patchSeries` / `pinBeat` — what the routes run), one frame at a time
//      in offset order, so every Series rule is enforced on every write. The
//      opening frame is not a pin: it becomes the Series' first frame.
//
// ── Which frame ─────────────────────────────────────────────────────────────
// The browser takes the frame ON SCREEN at the grab time (mediabunny's
// `canvasesAtTimestamps`: the last frame whose timestamp is ≤ t). ffmpeg's
// plain `-ss t -frames:v 1` takes the first frame AT OR AFTER t — one frame
// later whenever t falls inside a frame. So the cut seeks a little early,
// decodes up to t and keeps the LAST frame ≤ t (`select=lte(t,…)` +
// `-update 1`): the same picture the browser would have pinned. A grab past
// the clip's last frame falls back to the plain seek.
//
// ── Across alarms ───────────────────────────────────────────────────────────
// The stage's own state is its step result (`cuts`: one entry per clip with
// its jobs-table id and the attempt that started it). Each call polls every
// running cut once and answers `{ pending: true }` until all are done. A cut
// that failed THROWS; the runner retries once, and the retry starts a fresh
// cut for exactly the clips whose cut failed on an earlier attempt.
import { readSheets, readSeries, patchSeries, pinBeat, directorUrl, absolutize } from "../director.js";
import { mediaKey } from "../media.js";
import { grabTimes } from "../shot-sheet.ts";
import { FILM_RATES_USD } from "../film-plan.ts";
import { createJob, pollJob, startSandboxJob } from "../jobs.js";
import { getSandbox } from "../ffmpeg.js";

const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const sec = (x) => (Math.round(Number(x) * 1e6) / 1e6).toFixed(6);

/** The file a pinned frame is stored as — the same name `POST /api/shotsheet/pins` writes. */
export const pinFile = (seriesId, offset, takeId) => `pin_${seriesId}_${offset}s_${takeId || "manual"}.png`;

/** How far before a grab time the cut seeks, so it can decode up TO the grab. */
const LEAD_SECONDS = 2;

/**
 * The bash a cut runs in the sandbox: download the clip, one PNG per grab
 * time, each PUT to its R2 key through the Worker's `/ingest`.
 *
 * spec = { videoUrl (absolute), frames: [{ at, key }] }
 */
export function cutScript(env, spec) {
  const base = String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  const jd = `/tmp/stills-${crypto.randomUUID()}`;
  const lines = [
    "set -eo pipefail",
    `rm -rf ${jd} && mkdir -p ${jd} && cd ${jd}`,
    `curl -fsS -o in.mp4 ${shq(spec.videoUrl)}`,
  ];
  // Cut every frame first (each is a fraction of a second of decoding)...
  spec.frames.forEach((f, i) => {
    const at = Math.max(0, Number(f.at) || 0);
    const from = Math.max(0, at - LEAD_SECONDS);
    const within = at - from;
    const out = `f${i}.png`;
    lines.push(
      // Decode from just before the grab up to it; keep the last frame ≤ t.
      `ffmpeg -v error -y -ss ${sec(from)} -t ${sec(within + 0.5)} -i in.mp4 -vf ${shq(`select=lte(t\\,${sec(within)})`)} -vsync passthrough -update 1 ${out}`,
      // A grab past the last frame decodes nothing — take the frame there instead.
      `[ -s ${out} ] || ffmpeg -v error -y -sseof -0.1 -i in.mp4 -frames:v 1 -update 1 ${out}`,
    );
  });
  // ...then upload them all at once. One PUT after another was the whole cost
  // of this step (a round trip each, ~17 per clip); the uploads are
  // independent, so they run in parallel and the job fails if any one does.
  lines.push("pids=\"\"");
  spec.frames.forEach((f, i) => {
    lines.push(
      `curl -fsS -X PUT -H ${shq(`authorization: Bearer ${env.INGEST_TOKEN}`)} -H 'content-type: image/png' -T f${i}.png ${shq(`${base}/ingest/${f.key}`)} & pids="$pids $!"`,
    );
  });
  lines.push('fail=0; for p in $pids; do wait "$p" || fail=1; done; [ "$fail" = 0 ]');
  lines.push(`cd /tmp && rm -rf ${jd}`);
  return lines.join("\n");
}

/**
 * The real cutter: a detached job on the reused ffmpeg sandbox, on the
 * platform Daytona key (`env.DAYTONA_API_KEY`, ADR 0003).
 *
 *   start(env, spec) → jobId
 *   poll(env, jobId) → { status: 'running'|'done'|'error', error }
 */
export const daytonaCutter = {
  async start(env, spec) {
    const jobId = await createJob(env, "stills");
    const sandbox = await getSandbox(env);
    await startSandboxJob(env, jobId, sandbox, cutScript(env, spec), null);
    return jobId;
  },
  async poll(env, jobId) {
    const { Daytona } = await import("@daytona/sdk");
    const client = new Daytona({ apiKey: env.DAYTONA_API_KEY });
    const row = await pollJob(env, jobId, (id) => client.get(id));
    if (!row) return { status: "error", error: "the cut job was lost" };
    if (row.status === "done") return { status: "done", error: null };
    if (row.status === "error") return { status: "error", error: row.error || "the sandbox failed" };
    return { status: "running", error: null };
  },
};

/**
 * deps (optional): { cutter } — `daytonaCutter` unless a test passes a fake;
 * { pinBeat, patchSeries } — the Director helpers (a test wraps them to watch).
 */
export async function runStillsStage({ job, results, env, attempt = 1 }, deps = {}) {
  const cutter = deps.cutter || daytonaCutter;
  const pin = deps.pinBeat || pinBeat;
  const patch = deps.patchSeries || patchSeries;
  const pid = job.projectId;
  const run = results?.run;
  const seriesId = run?.seriesId;
  if (!seriesId) throw new Error("The Film has no shot sheet run yet — the run step did not finish.");
  if (!deps.cutter) {
    if (!env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the stills cannot be cut");
    if (!env?.INGEST_TOKEN || !env?.WORKER_PUBLIC_URL) {
      throw new Error("INGEST_TOKEN and WORKER_PUBLIC_URL must be set on the Worker — the cut frames have nowhere to go");
    }
  }

  const ledger = await readSheets(env, pid);
  const takes = new Map((ledger.takes || []).map((t) => [t.id, t]));
  const clips = (run.clips || []).filter((c) => c.status === "done");
  if (!clips.length) throw new Error("The shot sheet run drew no clips to cut.");

  // Every frame to cut, per clip, from the take's OWN sheet — the same shots
  // the clip's prompt was written from, so clip and cut agree on which is which.
  const plans = clips.map((clip) => {
    const take = takes.get(clip.takeId);
    if (!take?.file || !take.sheet?.shots?.length) {
      throw new Error(`Clip ${clip.part}: its take ${clip.takeId} is not in the ledger.`);
    }
    const times = grabTimes(take.sheet);
    const frames = take.sheet.shots.map((shot, i) => ({
      offset: shot.offset,
      kind: shot.kind,
      at: times[i],
      file: pinFile(seriesId, shot.offset, take.id),
    }));
    return { clip, take, frames };
  });

  // This stage's state from its last call, if any.
  const prev = (job.steps || []).find((s) => s.key === "stills")?.result;
  const prevCuts = new Map((prev?.cuts || []).map((c) => [c.part, c]));

  let spend = 0;
  const cuts = [];
  for (const { clip, take, frames } of plans) {
    let cut = prevCuts.get(clip.part);
    if (cut && cut.takeId !== take.id) cut = null;
    if (cut?.status === "running") {
      const polled = await cutter.poll(env, cut.jobId);
      cut = { ...cut, status: polled.status, error: polled.error || null };
    }
    // Nothing started yet, or a cut that failed on an EARLIER attempt: cut it (again).
    if (!cut || (cut.status === "error" && (cut.attempt || 1) < attempt)) {
      const jobId = await cutter.start(env, {
        videoUrl: absolutize(env, pid, directorUrl(take.file)),
        frames: frames.map((f) => ({ at: f.at, key: mediaKey(pid, "director", f.file) })),
      });
      cut = { part: clip.part, takeId: take.id, jobId, attempt, status: "running", error: null };
      spend += FILM_RATES_USD.sandboxMinute;
    }
    cuts.push(cut);
  }

  const failed = cuts.find((c) => c.status === "error");
  if (failed) {
    const where = cuts.length > 1 ? `Clip ${failed.part} of ${cuts.length}` : "The clip";
    const err = new Error(`${where}: the frame cut failed — ${String(failed.error || "the sandbox failed").slice(0, 400)}`);
    if (spend > 0) err.spend = spend;
    throw err;
  }

  const cutCount = cuts.filter((c) => c.status === "done").length;
  if (cutCount < cuts.length) {
    return {
      pending: true,
      summary: `Cutting stills — ${cutCount} of ${n(cuts.length, "clip")} cut`,
      result: { seriesId, cuts, firstFrame: null, frames: [] },
      spend,
    };
  }

  // Every cut finished: each frame must have landed before anything is pinned.
  const all = plans.flatMap(({ clip, take, frames }) => frames.map((f) => ({ ...f, part: clip.part, take })));
  for (const f of all) {
    const there = await env.BUCKET.head(mediaKey(pid, "director", f.file));
    if (!there) {
      throw withSpend(new Error(`Clip ${f.part}: the cut uploaded no frame for ${f.offset}s.`), spend);
    }
  }

  const series = await readSeries(env, pid, seriesId);
  if (!series) throw new Error(`The Film's Series ${seriesId} is gone.`);

  // The opening frame is the picture the film STARTS on — the Series' first frame.
  const opening = all.find((f) => f.kind === "opening") || null;
  if (opening) {
    const res = await patch(env, pid, seriesId, { imageUrl: directorUrl(opening.file) });
    if (!res.ok) throw withSpend(new Error(`The first frame was refused: ${refusal(res)}`), spend);
  }
  // Then every pin, through the Director one frame at a time, in offset order.
  const pins = all.filter((f) => f.kind !== "opening").sort((a, b) => a.offset - b.offset);
  for (const f of pins) {
    const res = await pin(env, pid, seriesId, {
      offset: f.offset,
      imageUrl: directorUrl(f.file),
      prompt: f.take.sheet?.premise ?? null,
      model: f.take.endpoint ?? null,
    });
    if (!res.ok) throw withSpend(new Error(`The pin at ${f.offset}s was refused: ${refusal(res)}`), spend);
  }

  const frames = [...(opening ? [opening] : []), ...pins].map((f) => ({
    offset: f.offset,
    kind: f.kind,
    part: f.part,
    imageUrl: directorUrl(f.file),
  }));
  const firstFrame = opening ? directorUrl(opening.file) : null;
  const summary = [n(pins.length, "frame pinned", "frames pinned"), firstFrame ? "first frame set" : "no first frame"].join(" · ");
  return { summary, result: { seriesId, cuts, firstFrame, frames }, spend };
}

function refusal(res) {
  if (res.missing) return "the Series is gone";
  if (res.noBeat) return "no such beat on the cue sheet";
  const issues = res.issues || res.invalid || {};
  const text = Object.values(issues).flat().join("; ");
  return text || "the Series would refuse it";
}

function withSpend(err, spend) {
  if (spend > 0) err.spend = spend;
  return err;
}
