// The Film job's "Sitting" stage (Auto, PRD #59 / #69, ADR 0001).
//
// The whole cue sheet — every Reel, appended to ONE session — played live by
// the Director and recorded as it plays, with nobody's tab open. The stage does
// not play it: it boots a Daytona box (lib/sitting-sandbox.js) that opens the
// runner page (`/sitting-runner.html`, src/sitting-runner/) in headless Chrome.
// That page runs the SAME session, transport and recorder code Stage does, over
// the token-authenticated routes in routes/sitting-runner.js, and files the
// recording as an ordinary kept sitting (`director-sittings`, stamped with the
// Film's id) — the unscored film the score stage lays music under.
//
// ── Across alarms ───────────────────────────────────────────────────────────
// A sitting takes many minutes, so each call does what is due and returns:
// the first call of an attempt starts the box and opens the run on the
// ledger (`director-sittings.runs[filmId]`); later calls read the runner's
// last word from that run (state, film seconds, target) and poll the box once,
// answering `{ pending: true }` with `{ elapsed, target }` until the page has
// kept the film. The box handle lives in the step's own result, like Stills.
//
// ── Failure ─────────────────────────────────────────────────────────────────
// The runner reporting `failed` (a fal error, the backstop), the box exiting
// without a kept film, or the box outliving its deadline THROWS. The job runner
// retries once — a fresh attempt, a fresh token, a fresh box command, a fresh
// sitting (a sitting cannot be resumed) — then stops and reports spend. A
// partial recording the page managed to keep stays kept; nothing is deleted.
//
// ── Spend ───────────────────────────────────────────────────────────────────
// Counted once per attempt, when it ends: the Director bills from `configure`
// with a 60-second minimum (SITTING_MIN_BILLED_SECONDS), per second of film
// after that, plus the box's minutes. Estimates at film-plan's rates.
import { absolutize, directorUrl, readSeries, readSittings, updateSittings } from "../director.js";
import { FILM_RATES_USD, SITTING_MIN_BILLED_SECONDS, formatLength } from "../film-plan.ts";
import { REEL_CHANGE_ALLOWANCE_SECONDS } from "../series.ts";
import { proxySecret } from "../proxy-token.js";
import { mintSittingToken } from "../sitting-token.js";
import { daytonaSittingRunner } from "../sitting-sandbox.js";
import { screeningFor } from "../../routes/stage.js";
import { runnerWallSeconds } from "../../routes/sitting-runner.js";

/** Slack past the page's own backstop before the box counts as hung. */
const DEADLINE_SLACK_SECONDS = 10 * 60;

/** The states in which the Director has already been configured — and so billed. */
const BILLED = new Set(["configuring", "buffering", "live", "closing", "ended", "failed", "uploading", "kept"]);

const round = (x) => Math.round(x * 1e6) / 1e6;

/** What one attempt cost, estimated: billed film plus the box's minutes. */
export function sittingSpend(run, wallSeconds) {
  const billed = run && BILLED.has(run.state) ? Math.max(SITTING_MIN_BILLED_SECONDS, Number(run.filmS) || 0) : 0;
  const boxMinutes = Math.max(1, Math.ceil((Number(wallSeconds) || 0) / 60));
  return round(billed * FILM_RATES_USD.sittingSecond + boxMinutes * FILM_RATES_USD.sandboxMinute);
}

const clock = (s) => formatLength(Math.max(0, Math.floor(Number(s) || 0)));

/**
 * deps (optional): { runner } — `daytonaSittingRunner` unless a test passes a
 * fake `{ start(env, spec) → jobId, poll(env, jobId) → { status, error } }`;
 * { now } — the wall clock.
 */
export async function runSittingStage({ job, results, env, attempt = 1 }, deps = {}) {
  const runner = deps.runner || daytonaSittingRunner;
  const now = deps.now || Date.now;
  const pid = job.projectId;
  const seriesId = results?.stills?.seriesId || results?.run?.seriesId || results?.cuesheet?.seriesId;
  if (!seriesId) throw new Error("The Film has no Series to sit — the earlier steps did not finish.");
  const base = String(env?.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("WORKER_PUBLIC_URL is not set on the Worker — the Sitting runner has nowhere to load from");
  if (!env?.FAL_KEY) throw new Error("No fal key connected — add yours in Settings › Connectors; the Sitting cannot be played.");
  if (!proxySecret(env)) throw new Error("FLUE_PROXY_SECRET is not set on the Worker — the Sitting runner cannot be authorised");
  if (!deps.runner && !env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the Sitting has no box to run in");

  const series = await readSeries(env, pid, seriesId);
  if (!series) throw new Error(`The Film's Series ${seriesId} is gone.`);
  const plan = screeningFor(env, pid, series);
  const reels = 1 + plan.reels.length;
  const planned = Math.max(SITTING_MIN_BILLED_SECONDS, plan.filmSeconds + plan.reels.length * REEL_CHANGE_ALLOWANCE_SECONDS);

  const prev = (job.steps || []).find((s) => s.key === "sitting")?.result;

  // ── A new attempt: mint its token, open its run, start its box ────────────
  if (!prev?.jobId || (prev.attempt || 1) !== attempt) {
    const token = await mintSittingToken(
      { filmId: job.id, projectId: pid, episodeId: job.episodeId, seriesId, userId: job.userId, attempt },
      proxySecret(env),
      { now: now() },
    );
    const startedAt = new Date(now()).toISOString();
    await updateSittings(env, pid, (db) => {
      db.runs = { ...(db.runs || {}), [job.id]: { attempt, seriesId, state: "starting", filmS: 0, target: planned, startedAt } };
      return {};
    });
    const deadlineMs = (runnerWallSeconds(plan.filmSeconds) + DEADLINE_SLACK_SECONDS) * 1000;
    // The token rides in the FRAGMENT: it never reaches a server log.
    const jobId = await runner.start(env, { runnerUrl: `${base}/sitting-runner.html#t=${token}`, deadlineMs });
    return {
      pending: true,
      summary: `Starting the Sitting — ${clock(planned)} of film, ${reels} reel${reels === 1 ? "" : "s"}`,
      result: { seriesId, jobId, attempt, startedAt, deadlineMs, state: "starting", elapsed: 0, target: planned, reels },
    };
  }

  // ── A running attempt: what did the page last say, and is the box alive? ──
  const ledger = await readSittings(env, pid);
  const run = ledger.runs?.[job.id];
  const mine = run && Number(run.attempt) === attempt ? run : null;
  const wallSeconds = (now() - Date.parse(prev.startedAt)) / 1000;
  const target = Number(mine?.target) || prev.target || planned;
  const elapsed = Number(mine?.filmS) || 0;

  const fail = (message) => {
    const err = new Error(message);
    const spend = sittingSpend(mine, wallSeconds);
    if (spend > 0) err.spend = spend;
    return err;
  };

  if (mine?.final === "failed") {
    const why = mine.detail || mine.message || "the Director session failed";
    throw fail(`The Sitting failed at ${clock(elapsed)} of ${clock(target)}: ${why}`);
  }

  if (mine?.kept) {
    const entry = (ledger.kept || []).find((s) => s.id === mine.kept);
    if (!entry) throw fail("The Sitting was kept but its record is gone.");
    const url = directorUrl(entry.file);
    return {
      summary: `Sitting kept — ${clock(entry.seconds || elapsed)} of film, ${reels} reel${reels === 1 ? "" : "s"}`,
      result: {
        seriesId,
        sittingId: entry.id,
        file: entry.file,
        url,
        fileUrl: absolutize(env, pid, url),
        contentType: entry.contentType,
        bytes: entry.bytes,
        seconds: entry.seconds || elapsed,
        target,
        reels,
        attempt,
      },
      spend: sittingSpend(mine, wallSeconds),
    };
  }

  const box = await runner.poll(env, prev.jobId);
  if (box.status === "error") {
    throw fail(`The Sitting's box failed: ${String(box.error || "the sandbox failed").slice(-400)}`);
  }
  if (box.status === "done") {
    // The page files the film BEFORE it reports done, so a clean exit with
    // nothing kept means the upload never landed.
    throw fail("The Sitting's box finished without keeping a film.");
  }
  if (wallSeconds * 1000 > (prev.deadlineMs || 0) + 60_000) {
    throw fail(`The Sitting ran past its deadline (${clock(wallSeconds)} of wall clock) without finishing.`);
  }

  const state = mine?.state || prev.state || "starting";
  const summary = BILLED.has(state)
    ? `Sitting — ${clock(elapsed)} of ${clock(target)} film${state === "uploading" ? " · keeping the film" : ""}`
    : `Starting the Sitting — ${clock(target)} of film, ${reels} reel${reels === 1 ? "" : "s"}`;
  return {
    pending: true,
    summary,
    result: { ...prev, state, elapsed, target, reel: mine?.reel ?? null },
  };
}
