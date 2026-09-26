// The Sitting runner's side of the Worker (Auto, PRD #59 / #69, ADR 0001).
//
// The Film job's `sitting` stage (lib/film-stages/sitting.js) boots a Daytona
// box, which opens `/sitting-runner.html#t=<token>` in headless Chrome. That
// page runs the SAME Director session, transport and recorder Stage does, and
// talks to the Worker ONLY through these routes:
//
//   GET  /api/sitting-runner/screening   what to play: configure + appended reels
//   ALL  /api/sitting-runner/fal/proxy   the fal realtime calls, on the PLATFORM key
//   POST /api/sitting-runner/progress    { state, filmS, target, … } — the card's clock
//   POST /api/sitting-runner/film        the recording (raw body), filed as a kept sitting
//
// None of them takes a cookie. Each verifies the job token (lib/sitting-token.js)
// and scopes itself to its claims — project, episode, Series, Film, attempt — so
// the prefix is exempt from the ownership middleware in index.js the way
// `/api/share/` is: the token is the credential. The fal key never leaves the
// Worker; the page gets a proxy that will only open the Director endpoint.
//
// The run's state is the `runs[filmId]` entry on the `director-sittings`
// document — the same ledger a kept sitting is filed into — so the stage, which
// polls it every ~15s, reads what the runner last said without a second store.
import { readSeries, updateSittings } from "../lib/director.js";
import { runWithContext } from "../lib/request-context.js";
import { sittingClaims } from "../lib/sitting-token.js";
import { DIRECTOR_ENDPOINT, fileSitting, forwardToFal, screeningFor } from "./stage.js";

export const RUNNER_PREFIX = "/api/sitting-runner/";

/**
 * The runner's own session cap, in seconds. Looser than the Stage's twenty
 * minutes because a 4:30 Film (plus a chunk of slip per seam) is generated
 * well behind realtime, and a capped heartbeat kills the sitting.
 */
export const RUNNER_MAX_SESSION_SECONDS = 40 * 60;

/**
 * The session's wall-clock backstop for a Film of this length — handed to the
 * page, which passes it to `createDirectorSession({ maxWallSeconds })`. The
 * Stage's default (240s) is shorter than a 2:00 Film takes to generate.
 */
export function runnerWallSeconds(filmSeconds) {
  const s = Number(filmSeconds) || 0;
  return Math.min(RUNNER_MAX_SESSION_SECONDS - 120, Math.max(600, Math.round(s * 6)));
}

const STATES = new Set(["loading", "opening", "configuring", "buffering", "live", "closing", "ended", "failed", "uploading", "kept"]);

/** Patch this Film's run on the ledger — only for the attempt the token names. */
export async function patchRun(env, claims, patch) {
  return updateSittings(env, claims.projectId, (db) => {
    const runs = { ...(db.runs || {}) };
    const run = runs[claims.filmId];
    if (!run || Number(run.attempt) !== Number(claims.attempt)) return { stale: true };
    runs[claims.filmId] = { ...run, ...patch, updatedAt: new Date().toISOString() };
    db.runs = runs;
    return { stale: false };
  });
}

/** Wrap a handler: verify the token, then run inside the Film's own scope. */
const withClaims = (handler) => async (c) => {
  const claims = await sittingClaims(c);
  if (!claims) return c.json({ error: "A valid, unexpired sitting token is required" }, 401);
  return runWithContext(
    { userId: claims.userId, caller: "auto", chatId: null, episodeId: claims.episodeId || undefined },
    () => handler(c, claims),
  );
};

export function registerSittingRunner(app) {
  app.get(
    "/api/sitting-runner/screening",
    withClaims(async (c, claims) => {
      const series = await readSeries(c.env, claims.projectId, claims.seriesId);
      if (!series) return c.json({ error: "The Film's Series is gone" }, 404);
      const plan = screeningFor(c.env, claims.projectId, series);
      await patchRun(c.env, claims, { state: "loading" });
      return c.json({
        filmId: claims.filmId,
        seriesId: series.id,
        title: series.title,
        endpoint: DIRECTOR_ENDPOINT,
        configure: plan.configure,
        reels: plan.reels,
        filmSeconds: plan.filmSeconds,
        maxWallSeconds: runnerWallSeconds(plan.filmSeconds),
      });
    }),
  );

  // The fal realtime calls (`/ice`, `/session`, the heartbeat), pinned and
  // capped exactly as the Stage's proxy — only the key differs: StorySeam's own
  // (ADR 0003), because an Auto Film never asks the author for one.
  app.all(
    "/api/sitting-runner/fal/proxy",
    withClaims((c) =>
      forwardToFal(c, c.env.FAL_KEY || "", {
        env: { ...c.env, MAX_SESSION_SECONDS: RUNNER_MAX_SESSION_SECONDS },
      }),
    ),
  );

  app.post(
    "/api/sitting-runner/progress",
    withClaims(async (c, claims) => {
      const body = await c.req.json().catch(() => ({}));
      const state = STATES.has(body.state) ? body.state : null;
      if (!state) return c.json({ error: "Unknown state" }, 400);
      const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : undefined);
      const patch = { state, filmS: num(body.filmS), target: num(body.target), reel: num(body.reel) };
      if (state === "failed" || state === "ended") patch.final = state;
      if (body.message) patch.message = String(body.message).slice(0, 500);
      if (body.detail) patch.detail = String(body.detail).slice(0, 1000);
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
      const res = await patchRun(c.env, claims, patch);
      if (res.stale) return c.json({ error: "This sitting is no longer the Film's current attempt" }, 409);
      return c.json({ ok: true });
    }),
  );

  // The recording, as the page's MediaRecorder produced it. A RAW body rather
  // than multipart: a 4:30 sitting is large, and a raw body with a known length
  // streams straight into R2 instead of being buffered in the isolate.
  app.post(
    "/api/sitting-runner/film",
    withClaims(async (c, claims) => {
      const series = await readSeries(c.env, claims.projectId, claims.seriesId);
      if (!series) return c.json({ error: "The Film's Series is gone" }, 404);
      const contentType = (c.req.header("content-type") || "video/webm").split(";")[0].trim();
      if (!/^video\//i.test(contentType)) return c.json({ error: "Send the recording as a video body" }, 400);
      const length = Number(c.req.header("content-length"));
      let body;
      let bytes;
      if (Number.isFinite(length) && length > 0 && c.req.raw.body) {
        body = c.req.raw.body;
        bytes = length;
      } else {
        body = await c.req.arrayBuffer();
        bytes = body.byteLength;
      }
      if (!bytes) return c.json({ error: "The recording is empty" }, 400);

      const seconds = Number(c.req.query("seconds")) || 0;
      const final = c.req.query("final") === "failed" ? "failed" : "ended";
      const entry = await fileSitting(c.env, claims.projectId, {
        series,
        body,
        bytes,
        contentType,
        seconds,
        extra: { filmId: claims.filmId, attempt: claims.attempt, source: "auto" },
      });
      await patchRun(c.env, claims, { state: "kept", final, kept: entry.id, filmS: seconds });
      return c.json({ ok: true, sitting: { id: entry.id, file: entry.file } });
    }),
  );
}
