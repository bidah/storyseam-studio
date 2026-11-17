// The Film job's "Shot sheet run" stage (Auto, PRD #59 / #67).
//
// The cue sheet's frames drawn as clips, exactly as the Shot sheet tab's Render
// does it (lib/shot-sheet-run.js — the same code): the Reel planner plans the
// Reels over every slot the cue sheet offers that is not refused, the seams are
// written as the Series' `reelChanges`, and ONE clip per Reel is submitted to
// fal on the AUTHOR's fal key (`env.FAL_KEY`, swapped in per job — lib/user-fal-key.js) with the Series' model
// sheets as references. Frames a seam costs are never drawn (ADR 0002).
//
// ── Across alarms ───────────────────────────────────────────────────────────
// A clip takes minutes, so this stage does not wait for one. Each call does
// what is due and returns: submit any clip not yet queued, poll every running
// take once (finalizing the ones fal says are COMPLETED), and answer
// `{ pending: true, … }` until every take is done — the runner keeps the step
// running and calls again on a later alarm (film-job.js › Pending stages).
//
// The run's state is the `director-sheets` ledger itself: every take this
// stage files carries the Film's id (`filmId`), so a re-invoked or retried
// stage finds its run there and never pays for a clip twice. A retry after a
// refusal re-submits only the clips that have no live take.
//
// ── Refusal ─────────────────────────────────────────────────────────────────
// A clip fal refuses — at submit, or FAILED on the queue — throws. The runner
// retries once (the retry re-submits that clip), then stops the job; every
// take already drawn is kept.
import { readSeries, readSheets } from "../director.js";
import { FILM_RATES_USD } from "../film-plan.ts";
import { buildRun, finishRender, planView, runErrors, submitClips, takeWithUrl, writeSeams } from "../shot-sheet-run.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** What one clip is estimated to cost: its seconds at film-plan's clip rate. */
export const clipSpend = (sheet) => Math.round((Number(sheet?.duration) || 0) * FILM_RATES_USD.clipSecond * 1e6) / 1e6;

/** deps (optional): { fetch } — fal's queue and the video download. */
export async function runRunStage({ job, results, env }, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const pid = job.projectId;
  const seriesId = results?.cuesheet?.seriesId || results?.sheets?.seriesId;
  if (!seriesId) throw new Error("The Film has no cue sheet yet — the cue sheet step did not finish.");
  const key = str(env?.FAL_KEY);
  if (!key) throw new Error("No fal key connected — add yours in Settings › Connectors; the shot sheet cannot be drawn.");

  const series = await readSeries(env, pid, seriesId);
  if (!series) throw new Error(`The Film's Series ${seriesId} is gone.`);

  // Every slot the cue sheet offers that is not refused, at the default clip
  // length — the planner decides the reels and which frames the seams cost.
  const { plan, sheets } = buildRun(env, pid, series);
  const errors = runErrors(plan, sheets);
  if (errors.length) throw new Error(`The shot sheet would be refused: ${errors.map((e) => e.message).join("; ")}`);

  // This Film's run, if it has one: newest takes first in the ledger.
  const ledger = await readSheets(env, pid);
  const mine = (ledger.takes || []).filter((t) => t.filmId === job.id && t.seriesId === seriesId);
  const latest = mine[0];
  const runId = latest && latest.parts === sheets.length ? latest.runId : crypto.randomUUID();
  let takes = mine.filter((t) => t.runId === runId);
  const liveTake = (part) => takes.find((t) => t.part === part && t.status !== "error");

  // Submit every clip without a live take — all of them on the first call.
  let spend = 0;
  const missing = sheets.map((_, i) => i + 1).filter((part) => !liveTake(part));
  if (missing.length) {
    const seamed = await writeSeams(env, pid, seriesId, plan);
    if (seamed.missing) throw new Error(`The Film's Series ${seriesId} is gone.`);
    if (seamed.introduced) throw new Error(`The Series would refuse these reel changes: ${seamed.introduced.join("; ")}`);
    const sent = await submitClips(env, pid, { seriesId, plan, sheets, key, runId, parts: missing, extra: { filmId: job.id } }, fetchFn);
    spend = sent.takes.reduce((sum, t) => sum + clipSpend(t.sheet), 0);
    takes = [...sent.takes, ...takes];
    if (sent.failed) throw withSpend(new Error(sent.failed), spend);
  }

  // Poll every running take once; a finished one is finalized by the poll.
  const clips = [];
  for (const [index, sheet] of sheets.entries()) {
    const part = index + 1;
    let take = liveTake(part);
    if (take.status === "running") take = await finishRender(env, pid, take, key, fetchFn);
    if (take.status === "error") {
      const where = sheets.length > 1 ? `Clip ${part} of ${sheets.length}` : "The clip";
      throw withSpend(new Error(`${where}: ${take.error || "fal refused it"}`), spend);
    }
    const reel = plan.reels[index];
    clips.push({
      part,
      reel: reel.reel,
      opensAt: reel.opensAt,
      frames: sheet.shots.length,
      offsets: sheet.shots.map((s) => s.offset),
      takeId: take.id,
      status: take.status,
      videoUrl: takeWithUrl(take).url,
    });
  }

  const done = clips.filter((c) => c.status === "done").length;
  const view = planView(plan);
  const summary = [
    n(view.reels.length, "reel"),
    n(view.seams.length, "seam"),
    n(view.skipped.length, "frame skipped", "frames skipped"),
    `${done} of ${n(clips.length, "clip")} drawn`,
  ].join(" · ");
  const result = { seriesId, runId, plan: view, clips };
  return done === clips.length ? { summary, result, spend } : { pending: true, summary, result, spend };
}

function withSpend(err, spend) {
  if (spend > 0) err.spend = spend;
  return err;
}
