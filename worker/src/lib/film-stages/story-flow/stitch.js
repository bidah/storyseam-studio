// The story flow's "Final cut" stage — the last one (/story-flow, the Seedance
// 2.5 Film). Every rendered segment joined, in order, into the ONE film the
// author gets back (media.js stitchScript: each normalised, an extension's
// replayed source trimmed, then concatenated), on the box, across alarms.
//
// The film is filed the way a Director Film is: as a kept row in the project's
// `director-sittings` ledger, with the joined file as its `scoredFile` (there is
// no separate score — Seedance wrote the sound). `completeFilm` then stamps the
// row with the Film (`film: { id, title }`), which is what lists it in the
// Editor's media pool (`/api/pool`) and the agent's list_media_pool as
// "Film — <title>". The row is found again by `filmId` on a re-run, never
// filed twice.
//
// result = { seriesId, sittingId, file, url, seconds, segments, jobId }
//   — the shape film-job.js `filmOf` reads for the finished Film.
import { directorUrl, readSeries, updateSittings } from "../../director.js";
import { filmResolutionOf, FILM_RATES_USD, formatLength } from "../../film-plan.ts";
import { daytonaStoryBox, storyKey } from "./media.js";

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** File the joined film as a kept row — once per Film (found again by `filmId`). → the row's id */
export async function fileStoryFilm(env, pid, { job, seriesId, title, file, seconds }) {
  let id = null;
  await updateSittings(env, pid, (db) => {
    const have = (db.kept || []).find((row) => row.filmId === job.id && row.source === "story-flow");
    id = have?.id || crypto.randomUUID();
    if (have?.scoredFile === file) return { abort: true };
    const entry = {
      ...(have || {}),
      id,
      seriesId,
      title,
      file,
      scoredFile: file,
      contentType: "video/mp4",
      seconds,
      recordedAt: have?.recordedAt || new Date().toISOString(),
      filmId: job.id,
      source: "story-flow",
    };
    db.seq = (db.seq || 0) + 1;
    db.kept = [entry, ...(db.kept || []).filter((row) => row.id !== id)];
    return {};
  });
  return id;
}

/** deps (optional): { box } — daytonaStoryBox-shaped. */
export async function runStoryFlowStitchStage({ job, results, env, attempt = 1 }, deps = {}) {
  const box = deps.box || daytonaStoryBox;
  const pid = job.projectId;
  const run = results?.run;
  const segs = (run?.segments || []).filter((s) => s.status === "done" && s.file);
  const planned = results?.prompts?.segments?.length || 0;
  if (!segs.length || segs.length !== planned) throw new Error("Not every segment was rendered — the video run did not finish.");
  if (!deps.box && !env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the segments cannot be joined");

  const seconds = segs.reduce((sum, s) => sum + (Number(s.dur) || 0), 0);
  const prev = (job.steps || []).find((s) => s.key === "stitch")?.result || {};
  let state = { ...prev };

  // A fresh attempt (or the first call) starts the join.
  if (!state.jobId || (state.attempt || 1) < attempt) {
    const file = `story-${slug(job.id)}-film-${crypto.randomUUID().slice(0, 6)}.mp4`;
    const jobId = await box.startStitch(env, {
      // A segment that continued the one before it (H3's run says so per
      // segment; Seedance's every one after the first) may replay its source.
      clips: segs.map((s) => ({ key: storyKey(pid, s.file), dur: s.dur, extended: s.extended ?? s.index > 0 })),
      outKey: storyKey(pid, file),
      resolution: filmResolutionOf(job.resolution),
    });
    state = { jobId, attempt, file };
    return {
      pending: true,
      summary: `Joining ${segs.length} segments into ${formatLength(seconds)}`,
      result: state,
      spend: FILM_RATES_USD.sandboxMinute,
    };
  }

  const polled = await box.poll(env, state.jobId);
  if (polled.status === "running") {
    return { pending: true, summary: `Joining ${segs.length} segments into ${formatLength(seconds)}`, result: state };
  }
  if (polled.status === "error") throw new Error(`The final cut failed — ${polled.error || "the sandbox failed"}`);

  const seriesId = run.seriesId || results?.prompts?.seriesId || null;
  const series = seriesId ? await readSeries(env, pid, seriesId) : null;
  const title = results?.world?.title || series?.title || "Story";
  const sittingId = await fileStoryFilm(env, pid, { job, seriesId, title, file: state.file, seconds });
  return {
    summary: `${formatLength(seconds)} film · ${segs.length} segment${segs.length === 1 ? "" : "s"} joined`,
    result: {
      seriesId,
      sittingId,
      file: state.file,
      url: directorUrl(state.file),
      seconds,
      segments: segs.length,
      jobId: state.jobId,
    },
  };
}
