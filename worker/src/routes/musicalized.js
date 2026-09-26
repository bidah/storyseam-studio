// The Musicalized version — a kept sitting with a score laid under it.
//
// ── What this file is, and what it deliberately is not ─────────────────────
// Rendering the cue is the ONE piece of scoring that cannot happen in the
// browser: ElevenLabs Music runs on fal, and fal wants a key. Everything else —
// measuring the film, finding where the picture turns, ducking the cue under
// the dialogue, writing the new file — is the browser's, because the browser is
// what has the film decoded and on screen, and because the picture's packets
// are COPIED there rather than re-encoded. The film you scored is the film you
// kept, bit for bit.
//
// That is also why this is not folded into the Cuts tab's `score_cut`, which
// already lays a music bed under a stitched episode with ffmpeg in a sandbox.
// Two things differ and both matter: the cue here is ONE continuous piece
// written in chunks that turn where the picture turns, and the mix costs no
// server time at all.
//
// ── The plan is measured from the FILM, never from the cue sheet ───────────
// The Director's chunks run long. A composition plan built from `directions[]`
// is early by two to seven seconds — which is not a rounding error, it is the
// score arriving before the cut it was written for, every time, cumulatively.
// So the length that matters is the one measured off the finished file, and the
// browser measures it before it asks for anything.
//
// ── Two calls, not one ─────────────────────────────────────────────────────
// A render takes a minute or more and a Worker request does not. POST submits
// and hands back the queue's id; GET asks how it is going, and the first time
// it says COMPLETED the mp3 is copied out of fal's storage into OUR bucket
// under a key derived from the request id — so asking twice writes the same key
// twice rather than minting two copies. A provider url is scratch space.
//
// ── The same work, without a browser ───────────────────────────────────────
// The Auto Film job scores its sitting on the server (lib/film-stages/score.js)
// and the agent can score any kept sitting (`score_sitting` → a JSON POST to
// `/scored`): the film measured and the cue mixed under it by ffmpeg in a
// Daytona sandbox (lib/film-score.js), the picture still stream-copied. The
// cue's submit/poll and the scored film's filing are plain functions
// (lib/musicalized-cue.js) shared by these routes and the job.
import { directorUrl, readSeries, readSittings } from "../lib/director.js";
import { putMedia } from "../lib/media.js";
import { planTotalMs, renderCostUsd, validatePlan } from "../lib/music-plan.ts";
import { MUSIC_ENDPOINT, fileScoredFilm, pollCue, submitCue } from "../lib/musicalized-cue.js";
import { directorFileOf, measureFilm, mixScoredFilm, scoredName } from "../lib/film-score.js";

export { MUSIC_ENDPOINT };

const falKeyOf = (c) => c.req.header("x-fal-key") || c.env.FAL_KEY || "";


export function registerMusicalized(app) {
  // Everything the tab needs to open: which sittings can be scored, which
  // already are, and per Series the standing music brief plus every cue already
  // rendered for it — the plans the next take can start from.
  app.get("/api/musicalized", async (c) => {
    const pid = c.get("projectId");
    const db = await readSittings(c.env, pid);
    const kept = [...(db.kept || [])].sort((a, b) =>
      String(b.recordedAt).localeCompare(String(a.recordedAt)),
    );
    // One read per Series rather than per sitting: several sittings of one
    // Series is the normal case, and the brief belongs to the Series.
    const ids = [...new Set(kept.map((s) => s.seriesId))];
    const rows = await Promise.all(ids.map((id) => readSeries(c.env, pid, id)));
    const series = Object.fromEntries(
      ids.map((id, i) => {
        const row = rows[i];
        return [id, row ? {
          id,
          title: row.title || "",
          prompts: row.prompts || {},
          // Empty or absent is a real answer, not a missing one: a piece can be
          // carried entirely by its sound design.
          musicStyle: row.prompts?.musicStyle || null,
          cues: (row.audioPieces || []).filter((p) => p.kind === "music"),
        } : null];
      }),
    );
    return c.json({
      sittings: kept.map((s) => ({
        ...s,
        url: directorUrl(s.file),
        scoredUrl: directorUrl(s.scoredFile),
        musicStyle: series[s.seriesId]?.musicStyle ?? null,
      })),
      series,
      model: MUSIC_ENDPOINT,
    });
  });

  // Rehearse: what the plan would cost, how long it adds up to, and every reason
  // fal would refuse it. Free, and the author sees it before the render.
  app.post("/api/musicalized/plan/check", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const filmMs = Number(body.filmMs) || undefined;
    const errors = validatePlan(body.plan, filmMs);
    const totalMs = errors.length ? 0 : planTotalMs(body.plan);
    return c.json({
      errors,
      totalMs,
      filmMs: filmMs ?? null,
      // Said in dollars because it is the number that decides whether a plan is
      // worth another pass, and nobody converts minutes to money in their head.
      costUsd: errors.length ? null : Number(renderCostUsd(totalMs).toFixed(3)),
    });
  });

  // ── Render the cue ────────────────────────────────────────────────────────
  //
  // Deliberately NOT routed through the Stage's fal proxy. That proxy is pinned
  // to the Director endpoint and its session routes, and the pin is the whole
  // point of it — a proxy that forwards to whatever model a body names is a fal
  // key with extra steps. So this is a second, equally narrow door: one model,
  // one queue, the plan validated here before a cent is spent.
  app.post("/api/musicalized/cue", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const seriesId = String(body.seriesId || "");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "A cue is written for a Series — send a `seriesId` that exists" }, 404);

    const res = await submitCue(c.env, pid, { seriesId, plan: body.plan, filmMs: body.filmMs, key: falKeyOf(c) });
    if (!res.ok) {
      const { ok: _ok, status, ...err } = res;
      return c.json(err, status);
    }
    const { ok: _ok, ...out } = res;
    return c.json({ ok: true, ...out });
  });

  // Ask the queue how it is going. On the first COMPLETED, copy the mp3 into our
  // bucket and file it on the Series as an `audioPieces` entry of kind `music`
  // carrying the PLAN as its prompt — verbatim, with the seed beside it, so
  // "the same but quieter" is a small change rather than a new piece.
  app.get("/api/musicalized/cue/:requestId", async (c) => {
    const pid = c.get("projectId");
    const requestId = c.req.param("requestId");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return c.json({ error: "unusable request id" }, 400);
    const key = falKeyOf(c);
    if (!key) return c.json({ error: "no fal key", code: "no_fal_key" }, 401);
    const res = await pollCue(c.env, pid, requestId, { seriesId: c.req.query("seriesId") || "", key });
    if (res.status !== "done") return c.json(res);
    const { seconds: _seconds, ...out } = res;
    return c.json(out);
  });

  // ── The scored film, coming back ──────────────────────────────────────────
  //
  // Two ways in, one filing. Multipart: the browser mixed it and uploads it
  // whole. JSON `{ sittingId, cueUrl | cueFile, mix?, plan?, musicStyle? }`:
  // nobody mixed it yet — the Worker measures the film and lays the cue under
  // it in a sandbox (the agent's `score_sitting`), the picture stream-copied
  // either way. Filed BESIDE the sitting it came from rather than over it: a
  // sitting and its scored version are two files of one film.
  app.post("/api/musicalized/scored", async (c) => {
    const pid = c.get("projectId");
    if (/application\/json/i.test(c.req.header("content-type") || "")) return scoreOnServer(c, pid);

    let form;
    try { form = await c.req.parseBody(); } catch { return c.json({ error: "Expected multipart form data" }, 400); }

    const sittingId = String(form.sittingId || "");
    const film = form.film;
    if (!(film instanceof File)) return c.json({ error: "Attach the scored film as `film`" }, 400);
    const bytes = await film.arrayBuffer();
    if (!bytes.byteLength) return c.json({ error: "The scored film is empty" }, 400);

    const name = scoredName(sittingId);
    await putMedia(c.env, pid, "director", name, bytes, film.type || "video/mp4");

    const res = await fileScoredFilm(c.env, pid, {
      sittingId,
      seriesId: typeof form.seriesId === "string" ? form.seriesId : "",
      name,
      plan: typeof form.plan === "string" ? form.plan : undefined,
      cueFile: form.cueFile,
      cueUrl: form.cueUrl,
      mix: parseJson(form.mix),
      musicStyle: typeof form.musicStyle === "string" ? form.musicStyle : undefined,
    });
    if (res.missing) return c.json({ error: "No such sitting" }, 404);
    return c.json({ ok: true, scoredUrl: res.scoredUrl, file: res.file });
  });
}

// The JSON half of `/scored`: measure the kept film, mix the cue under it in
// the sandbox, file it. Inline — the request waits the minute or two it takes.
async function scoreOnServer(c, pid) {
  let body;
  try { body = await c.req.json(); } catch { body = {}; }
  const sittingId = String(body.sittingId || "");
  const kept = ((await readSittings(c.env, pid)).kept || []).find((s) => s.id === sittingId);
  if (!kept) return c.json({ error: "No such sitting" }, 404);
  const cueFile = directorFileOf(body.cueFile || body.cueUrl);
  if (!cueFile) return c.json({ error: "Name the cue to lay under it — `cueUrl` (a /director-media/ url) or `cueFile`" }, 400);
  if (!c.env.DAYTONA_API_KEY || !c.env.INGEST_TOKEN) {
    return c.json({ error: "Scoring on the server needs the sandbox (DAYTONA_API_KEY, INGEST_TOKEN)" }, 503);
  }

  let measured;
  try {
    measured = await measureFilm(c.env, pid, kept.file);
  } catch (err) {
    return c.json({ error: `could not measure the film: ${String(err?.message || err).slice(0, 400)}` }, 502);
  }
  // The measured dialogue windows unless the caller brought its own.
  const mix = { ducks: measured.ducks, ...(body.mix && typeof body.mix === "object" ? body.mix : {}) };
  const name = scoredName(sittingId, measured.videoCodec);
  try {
    await mixScoredFilm(c.env, pid, {
      filmFile: kept.file, cueFile, outFile: name, durationMs: measured.durationMs, hasAudio: measured.hasAudio, mix,
    });
  } catch (err) {
    return c.json({ error: `the mix failed: ${String(err?.message || err).slice(0, 400)}` }, 502);
  }
  const res = await fileScoredFilm(c.env, pid, {
    sittingId,
    seriesId: body.seriesId || kept.seriesId,
    name,
    plan: body.plan,
    cueFile,
    cueUrl: directorUrl(cueFile),
    mix,
    musicStyle: typeof body.musicStyle === "string" ? body.musicStyle : undefined,
  });
  if (res.missing) return c.json({ error: "No such sitting" }, 404);
  return c.json({ ok: true, scoredUrl: res.scoredUrl, file: res.file, filmMs: measured.durationMs, ducks: measured.ducks });
}

function parseJson(value) {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
