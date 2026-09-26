// The Film job's "Score" stage (Auto, PRD #59 / #70) — the last one.
//
// The Musicalized tab scores a kept sitting in the BROWSER: it measures the
// finished film, builds the composition plan from that measurement, renders
// one continuous cue on fal, and muxes it under the picture with the video
// packets copied. Auto has no browser (ADR 0001), so this stage does the same
// on the server, in three steps across alarms:
//
//   1. MEASURE — a detached Daytona job (lib/film-score.js) reads the kept
//      film's real length (ffprobe), where the picture cuts (ffmpeg's
//      `select='gt(scene,0.3)'`) and its own audio's loudness per second (for
//      the dialogue windows the bed ducks under).
//   2. CUE — the Worker builds the plan from THOSE numbers (`planFromFilm`:
//      the brief as a starter, split where the picture turns, fitted to the
//      measured length — never the cue sheet's), submits it to ElevenLabs Music
//      on fal on the PLATFORM key (`env.FAL_KEY`, ADR 0003) through the same
//      helpers the Musicalized routes run (lib/musicalized-cue.js), and polls it
//      to completion; the mp3 is filed on the Series like any cue.
//   3. MIX — a second detached job lays the cue under the picture (`-c:v copy`,
//      the film's own audio at full level, the bed faded in and ducked, AAC,
//      faststart mp4) and uploads it; the scored film is filed BESIDE the
//      sitting on its kept row (`scoredFile`). The unscored sitting is only
//      read — it is kept, untouched.
//
// ── Input: what the Sitting stage must hand over ───────────────────────────
//   results.sitting = { sittingId, file, url, seriesId, … } (film-stages/sitting.js)
//     sittingId — the kept row's id in `director-sittings` (the scored film is
//                 filed on it);
//     file | url — the kept film: its `director` media file name, or its
//                 `/director-media/<file>` url (one is enough; if both are
//                 missing it is read off the kept row). The sandbox downloads
//                 it from `/files/<its R2 key>` — the same place `fileUrl` points.
//
// ── Output (what the Film surface and later versions read) ─────────────────
//   result = { seriesId, sittingId, url, file,            ← the SCORED film
//              unscored: { file, url },                    ← the sitting, kept
//              cue: { requestId, file, url, seconds, chunks, attempt, status },
//              plan, brief, measured: { durationMs, hasAudio, videoCodec, turns, ducks },
//              measure: {jobId…}, mix: {jobId…} }
//
// ── Across alarms and retries ──────────────────────────────────────────────
// The stage's state is its own step result. Each call does what is due and
// answers `{ pending: true }` until the scored film is filed. A step that
// failed THROWS; the runner retries once, and the retry redoes exactly the
// step that failed on the earlier attempt (the Stills stage's rule).
import { readSeries, readSittings, directorUrl } from "../director.js";
import { FILM_RATES_USD } from "../film-plan.ts";
import { planTotalMs, renderCostUsd, styleTags } from "../music-plan.ts";
import { DEFAULT_MIX, pickTurns, planFromFilm } from "../score-mix.ts";
import { daytonaScorer, directorFileOf, directorKey, parseMeasurement, scoredName, withDucks } from "../film-score.js";
import { fileScoredFilm, pendingCueFor, pollCue, submitCue } from "../musicalized-cue.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The brief the cue is written in when the Series has none. */
export const DEFAULT_BRIEF = "cinematic instrumental score, orchestral, underscore";

/**
 * The music brief: the Series' standing one when it has one; otherwise the
 * writing model's reading of the Film's prompt and World, as style tags;
 * otherwise a plain underscore. Never throws — a Film without a brief still
 * gets a score.
 */
export async function briefFor({ job, results, series, model }) {
  const standing = str(series?.prompts?.musicStyle);
  if (standing) return standing;
  if (model?.json) {
    try {
      const world = results?.world || {};
      const answer = await model.json({
        messages: [
          {
            role: "system",
            content: [
              "You write the music brief for a short film's one continuous instrumental score.",
              "Answer with ONE JSON object: { \"tags\": [string] } — 3 to 6 short style tags (genre,",
              "instruments, tempo, mood), comma-free, no vocals, no lyrics.",
            ].join(" "),
          },
          {
            role: "user",
            content: [`Prompt: ${job.prompt}`, world.idea && `Idea: ${world.idea}`, world.logline && `Logline: ${world.logline}`]
              .filter(Boolean).join("\n"),
          },
        ],
        maxTokens: 300,
        temperature: 0.7,
      });
      const tags = styleTags((answer?.tags || []).map(str).join(", "));
      if (tags.length) return tags.join(", ");
    } catch { /* the default below */ }
  }
  return DEFAULT_BRIEF;
}

/**
 * deps (optional): { scorer } — `daytonaScorer` unless a test passes a fake;
 * { fetch } — fal's queue and the cue download.
 */
export async function runScoreStage({ job, results, env, attempt = 1, model }, deps = {}) {
  const scorer = deps.scorer || daytonaScorer;
  const fetchFn = deps.fetch || fetch;
  const pid = job.projectId;

  // ── What to score ──────────────────────────────────────────────────────────
  const sitting = results?.sitting;
  const sittingId = str(sitting?.sittingId || sitting?.id);
  if (!sittingId) throw new Error("The Film has no kept sitting yet — the sitting step did not finish.");
  const kept = ((await readSittings(env, pid)).kept || []).find((s) => s.id === sittingId) || null;
  const filmFile = directorFileOf(sitting.file || sitting.url) || str(kept?.file);
  if (!filmFile) throw new Error(`The kept sitting ${sittingId} has no film to score.`);
  const seriesId = str(sitting.seriesId || kept?.seriesId || results?.cuesheet?.seriesId || results?.run?.seriesId);
  const key = str(env?.FAL_KEY);
  if (!key) throw new Error("FAL_KEY is not set on the Worker — the cue cannot be rendered");
  if (!deps.scorer) {
    if (!env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the film cannot be measured or mixed");
    if (!env?.INGEST_TOKEN || !env?.WORKER_PUBLIC_URL) {
      throw new Error("INGEST_TOKEN and WORKER_PUBLIC_URL must be set on the Worker — the scored film has nowhere to go");
    }
  }

  const prev = (job.steps || []).find((s) => s.key === "score")?.result;
  const same = prev?.sittingId === sittingId && prev?.unscored?.file === filmFile;
  let state = same ? { ...prev } : {};
  state = { ...state, seriesId, sittingId, unscored: { file: filmFile, url: directorUrl(filmFile) } };
  let spend = 0;
  const pending = (summary) => ({ pending: true, summary, result: state, spend });
  const fail = (message) => {
    const err = new Error(message);
    if (spend > 0) err.spend = spend;
    return err;
  };
  // Redo a step whose job failed on an EARLIER attempt; a failure on this one throws.
  const redo = (s) => !s || (s.status === "error" && (s.attempt || 1) < attempt);

  // ── 1. Measure the film ────────────────────────────────────────────────────
  if (!state.measured) {
    let m = state.measure;
    if (m?.status === "running") {
      const polled = await scorer.poll(env, m.jobId);
      m = { ...m, status: polled.status, error: polled.error || null };
    }
    if (redo(m)) {
      const started = await scorer.startMeasure(env, { filmKey: directorKey(pid, filmFile) });
      m = { ...started, attempt, status: "running", error: null };
      spend += FILM_RATES_USD.sandboxMinute;
    }
    state.measure = m;
    if (m.status === "error") throw fail(`Measuring the film failed — ${String(m.error || "the sandbox failed").slice(0, 400)}`);
    if (m.status === "running") return pending("Measuring the kept film — its length and where the picture turns");

    const measured = withDucks(parseMeasurement(await scorer.readMeasure(env, m.jobId, m.outPath)));
    state.measured = {
      durationMs: measured.durationMs,
      hasAudio: measured.hasAudio,
      videoCodec: measured.videoCodec,
      turns: pickTurns(measured.cuts, measured.durationMs),
      ducks: measured.ducks,
    };
  }
  const { durationMs } = state.measured;

  // ── 2. The cue: planned from the measurement, rendered on the platform key ─
  if (!state.plan) {
    const series = seriesId ? await readSeries(env, pid, seriesId) : null;
    state.brief = await briefFor({ job, results, series, model });
    state.plan = planFromFilm({ brief: state.brief, filmMs: durationMs, turns: state.measured.turns });
  }
  let cue = state.cue;
  if (cue?.status === "running") {
    const polled = await pollCue(env, pid, cue.requestId, { seriesId, key }, fetchFn);
    if (polled.status === "done") {
      cue = { ...cue, status: "done", file: polled.file, url: polled.url, seconds: polled.seconds ?? durationMs / 1000, pieceId: polled.pieceId };
    } else if (polled.status === "error") {
      cue = { ...cue, status: "error", error: polled.error };
    } else {
      cue = { ...cue, status: "running", queue: polled.queue ?? null };
    }
  }
  if (!cue || redo(cue)) {
    // An eviction between the submit and the step's commit left a render parked
    // for this Film — pick it up rather than pay for a second one.
    const parked = !cue ? await pendingCueFor(env, pid, job.id) : null;
    if (parked) {
      cue = { requestId: parked.requestId, attempt, status: "running", chunks: state.plan.chunks.length };
    } else {
      const sent = await submitCue(env, pid, { seriesId, plan: state.plan, filmMs: durationMs, key, extra: { filmId: job.id } }, fetchFn);
      if (!sent.ok) throw fail(`fal refused the cue: ${sent.error}${sent.errors ? ` — ${sent.errors.map((e) => e.message).join("; ")}` : ""}`);
      spend += renderCostUsd(planTotalMs(state.plan));
      cue = { requestId: sent.requestId, attempt, status: "running", chunks: state.plan.chunks.length };
    }
  }
  state.cue = cue;
  if (cue.status === "error") throw fail(`The cue render failed (request ${cue.requestId}) — ${String(cue.error || "fal failed it").slice(0, 400)}`);
  if (cue.status === "running") {
    return pending(`Writing the cue — ${clock(durationMs)} in ${state.plan.chunks.length} chunks${cue.queue ? ` (${cue.queue.toLowerCase().replace(/_/g, " ")})` : ""}`);
  }

  // ── 3. Mix it under the picture, and file the scored film ──────────────────
  let mix = state.mix;
  if (mix?.status === "running") {
    const polled = await scorer.poll(env, mix.jobId);
    mix = { ...mix, status: polled.status, error: polled.error || null };
  }
  if (redo(mix)) {
    const file = scoredName(sittingId, state.measured.videoCodec);
    const settings = { ducks: state.measured.ducks };
    const jobId = await scorer.startMix(env, {
      filmKey: directorKey(pid, filmFile),
      cueKey: directorKey(pid, cue.file),
      outKey: directorKey(pid, file),
      durationMs,
      hasAudio: state.measured.hasAudio,
      mix: settings,
    });
    mix = { jobId, file, settings, attempt, status: "running", error: null };
    spend += FILM_RATES_USD.sandboxMinute;
  }
  state.mix = mix;
  if (mix.status === "error") throw fail(`Mixing the cue under the film failed — ${String(mix.error || "the sandbox failed").slice(0, 400)}`);
  if (mix.status === "running") return pending("Laying the cue under the picture — the picture copied, not re-encoded");

  if (!(await env.BUCKET.head(directorKey(pid, mix.file)))) {
    throw fail("The mix finished but uploaded no scored film.");
  }
  const filed = await fileScoredFilm(env, pid, {
    sittingId,
    seriesId,
    name: mix.file,
    plan: state.plan,
    cueFile: cue.file,
    cueUrl: cue.url,
    mix: { ...DEFAULT_MIX, ...mix.settings },
    musicStyle: state.brief,
  });
  if (!filed.ok) throw fail(`The kept sitting ${sittingId} is gone — the scored film was not filed.`);

  state.url = directorUrl(mix.file);
  state.file = mix.file;
  const summary = `Cue ${clock(cue.seconds * 1000)} in ${state.plan.chunks.length} chunks · scored film filed beside the sitting`;
  return { summary, result: state, spend };
}
