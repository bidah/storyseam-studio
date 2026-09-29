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
//   2. PIECES — the score's pacing was WRITTEN with the shot list: the Shot
//      list stage's music cues (`results.shotlist.music`, one fixed vocabulary,
//      src/lib/music-cues.ts) say where the story turns and to what. Here they
//      are laid on the MEASURED film (`cuesOnFilm`: scaled by measured/planned,
//      then snapped to the nearest real picture cut) and grouped into PIECES
//      (`piecesFromCues`): consecutive cues of one family stay one render, one
//      ElevenLabs chunk per cue; a change of family starts a new piece; a
//      `silence` cue is a gap nobody renders. At most four pieces, each its own
//      composition plan and seed, each running a second past its end where the
//      next piece starts, for the crossfade. Every piece is sent to ElevenLabs
//      Music on fal on the PLATFORM key (`env.FAL_KEY`, ADR 0003) through the
//      Musicalized helpers (lib/musicalized-cue.js), all polled to completion
//      and filed on the Series.
//      FALLBACK — a shot list with no cues (older Films, a model that skipped
//      them) is scored the old way, as ONE piece: the shot list's story moments
//      on the measured clock go to the writing model, which answers the chunks
//      (`writeScorePlan` → `repairScorePlan`), or failing that the mechanical
//      plan (`planFromFilm`: the brief, split at the hardest cuts). The Film is
//      never failed over its music being plain.
//   3. MIX — a second detached job lays the pieces under the picture, each
//      faded in and out and delayed to its offset, summed, then held at the bed
//      level (`-c:v copy`, the film's own audio at full level, the bed ducked,
//      AAC, faststart mp4) and uploads it; the scored film is filed BESIDE the
//      sitting on its kept row (`scoredFile`, and `cuePieces`). The unscored
//      sitting is only read — it is kept, untouched.
//
// ── Silences, twice ────────────────────────────────────────────────────────
// ElevenLabs cannot render literal silence. From cues, a silence is simply
// never rendered — the pieces either side of it end and begin there, faded;
// from the fallback plan it is a chunk (`[Held breath]`) asking for near
// silence. Either way its span ALSO goes into the mix (`silenceSpans`: -80 dB,
// 1.5 s linear ramps out and back in) as a guarantee, and is filed with the
// scored film.
//
// ── Input: what the Sitting stage must hand over ───────────────────────────
//   results.sitting = { sittingId, file, url, seriesId, … } (film-stages/sitting.js)
//     sittingId — the kept row's id in `director-sittings` (the scored film is
//                 filed on it);
//     file | url — the kept film: its `director` media file name, or its
//                 `/director-media/<file>` url (one is enough; if both are
//                 missing it is read off the kept row). The sandbox downloads
//                 it from `/files/<its R2 key>` — the same place `fileUrl` points.
//   results.shotlist.music — the cue layer (optional; none → the fallback).
//
// ── Output (what the Film surface and later versions read) ─────────────────
//   result = { seriesId, sittingId, url, file,            ← the SCORED film
//              unscored: { file, url },                    ← the sitting, kept
//              pieces: [{ index, startMs, endMs, lengthMs, fadeInSec, fadeOutSec,
//                         cues, plan, render: { requestId, file, url, status, attempt } }],
//              cue, plan,                                  ← piece 0's, for old readers
//              brief, planBy: 'cues' | 'writer' | 'picture',
//              cues: [{ cue, energy, at, startSec, snapped, … }],   ← cues, measured clock
//              moments: [{ at, planned, title, what, dialogue, snapped }],  ← fallback only
//              silences: [{ from, to, section }],                           ← seconds, film clock
//              measured: { durationMs, hasAudio, videoCodec, cuts, turns, ducks },
//              measure: {jobId…}, mix: {jobId…} }
//
// ── Across alarms and retries ──────────────────────────────────────────────
// The stage's state is its own step result. Each call does what is due and
// answers `{ pending: true }` until the scored film is filed. A step that
// failed THROWS; the runner retries once, and the retry redoes exactly the
// step that failed on the earlier attempt (the Stills stage's rule) — for the
// renders, exactly the PIECES that failed; the finished ones are kept.
import { readSeries, readSittings, directorUrl } from "../director.js";
import { readDoc } from "../docs.js";
import { normalizeShot } from "../shots.js";
import { FILM_RATES_USD, filmMusicOf } from "../film-plan.ts";
import { CHUNK_MAX_MS, CHUNK_MIN_MS, MAX_CHUNKS, planTotalMs, renderCostUsd, styleTags } from "../music-plan.ts";
import {
  DEFAULT_MIX,
  MAX_SILENCES,
  SILENCE_CLEAR_END_MS,
  SILENCE_CLEAR_START_MS,
  SILENCE_MIN_MS,
  momentsOnFilm,
  pickTurns,
  planFromFilm,
  repairScorePlan,
  silenceSpans,
  storyMoments,
} from "../score-mix.ts";
import { cuesOnFilm, piecesFromCues, piecesSummary } from "../music-cues.ts";
import { filmPlanFor } from "./shotlist.js";
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

const readShots = async (env, pid) =>
  ((await readDoc(env, pid, "shotlist", { shots: [] })).shots || []).map(normalizeShot);

const secs = (ms) => Math.round(ms / 100) / 10;

/**
 * What the writing model is asked for the plan: the score-film rules, the
 * brief, the MEASURED length, the story moments where they landed, and the
 * dialogue windows. Exported for the tests.
 */
export function scorePlanMessages({ brief, filmMs, moments = [], ducks = [], turns = [] }) {
  const filmSec = secs(filmMs);
  const typical = filmMs >= 120_000 ? "2–4" : filmMs >= 45_000 ? "1–2" : "0–1";
  const system = [
    "You write the composition plan for ONE continuous instrumental cue laid under a finished short film,",
    "rendered by ElevenLabs Music. The film is already cut: you score the picture that exists.",
    "",
    "A chunk is a MOVEMENT of the film. Name it for what that stretch of picture IS, in square brackets",
    "and nothing else — [Cold open], [The bay, quiet], [It turns], [The chase], [Aftermath].",
    "- positive_styles: what ARRIVES here — instruments, texture, motion, dynamics. At least one.",
    "- negative_styles: what LEAVES, or must not appear. As load-bearing as the positives: a cue that",
    "  never drops anything never turns.",
    "- context_adherence: \"high\" keeps one continuous piece (the default); \"low\" lets a chunk break",
    "  away where the story cuts hard.",
    "- The FIRST chunk's positive_styles carry the brief's genre — it sets the genre of the whole piece.",
    "- The big story turns MUST be marked by a change in the music: a boundary at the moment, and a",
    "  different texture/energy on either side of it. Start a chunk at (or within a second of) the",
    "  moment's second; do not start it before.",
    "- No vocals, no lyrics, anywhere.",
    "",
    "SILENCES. We do not want music all the time. Mark a chunk \"silence\": true where the story wants",
    "breath — a heavy exchange of dialogue, a held moment right before a big action, a reveal. Its",
    "section names the moment ([Held breath], [Silence]); its positive_styles are like \"near silence\",",
    "\"room tone only\", \"single sustained very soft note fading to nothing\", and its negative_styles",
    "block drums, percussion, melody, pads. The music is faded out to nothing under it.",
    `Rules: ${typical} silences for this length (at most ${MAX_SILENCES}), each ${SILENCE_MIN_MS / 1000}–15 s,`,
    `never in the first ${SILENCE_CLEAR_START_MS / 1000} s or the last ${SILENCE_CLEAR_END_MS / 1000} s.`,
    "The music AFTER a silence should re-enter changed — a silence is a hinge, not a pause.",
    "",
    `Arithmetic: each chunk is ${CHUNK_MIN_MS / 1000}–${CHUNK_MAX_MS / 1000} s, at most ${MAX_CHUNKS} chunks,`,
    `and the duration_ms of all chunks add up to EXACTLY ${filmMs}. Chunks follow each other with no gaps.`,
    "The last chunk (about 6 s) is the ending: a final sustained chord, a clean ending.",
    "",
    "Answer with ONE JSON object and nothing else:",
    "{ \"chunks\": [ { \"section\": \"Cold open\", \"silence\": false, \"positive_styles\": [string],",
    "  \"negative_styles\": [string], \"context_adherence\": \"high\", \"duration_ms\": number } ] }",
  ].join("\n");
  const user = [
    `Music brief (genre for the first chunk): ${brief}`,
    `The film runs ${filmSec} s (${filmMs} ms) — MEASURED; the durations must add up to this.`,
    "",
    "Story moments, at the second each one lands in the film:",
    ...(moments.length
      ? moments.map((m) => `- ${m.at}s — ${m.title}${m.dialogue ? " [dialogue]" : ""}${m.what ? `: ${m.what}` : ""}`)
      : ["- (no script — write the arc from the picture's turns below)"]),
    "",
    `Dialogue / loud film audio (the music is ducked under these): ${ducks.length ? ducks.map(([a, b]) => `${a}–${b}s`).join(", ") : "none measured"}`,
    `The picture's hardest cuts: ${turns.length ? turns.map((t) => `${t}s`).join(", ") : "none"}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * The plan, WRITTEN: the model answers, pure code repairs it. → `{ plan,
 * silences }`, or null when the model is missing, throws, or answers something
 * no repair makes renderable — the caller then falls back to `planFromFilm`.
 */
export async function writeScorePlan({ model, brief, filmMs, moments, ducks, turns }) {
  if (!model?.json) return null;
  try {
    const answer = await model.json({
      messages: scorePlanMessages({ brief, filmMs, moments, ducks, turns }),
      maxTokens: 4000,
      temperature: 0.7,
    });
    return repairScorePlan(answer, { brief, filmMs });
  } catch {
    return null;
  }
}

/**
 * The story moments on the measured clock, from the shot list and the cue
 * sheet's planned length. Never throws — no script means no moments, and the
 * plan is written from the picture alone.
 */
async function momentsFor({ job, results, env, measured }, deps) {
  try {
    const shots = await (deps.readShots || readShots)(env, job.projectId);
    const plannedSec = Number(results?.cuesheet?.seconds) || Number(results?.shotlist?.seconds) || filmPlanFor(job).seconds;
    const cuts = measured.cuts || (measured.turns || []).map((at) => ({ at, score: 1 }));
    return momentsOnFilm(storyMoments(shots, plannedSec), { plannedSec, filmMs: measured.durationMs, cuts });
  } catch {
    return [];
  }
}

/** One piece covering the whole film — the old single cue, as a piece. */
function wholeFilmPiece(plan, filmMs, render) {
  return {
    index: 0,
    startMs: 0,
    endMs: filmMs,
    lengthMs: planTotalMs(plan),
    fadeInSec: DEFAULT_MIX.fadeInSec,
    fadeOutSec: 0,
    cues: [],
    plan,
    ...(render ? { render } : {}),
  };
}

/**
 * The Shot list's music cues on the MEASURED film, grouped into the pieces to
 * render. → { cues, pieces, silences }, or null when the shot list wrote no
 * cues (or nothing renderable survives) — the caller then scores the old way.
 */
export function piecesForCues({ job, results, measured, brief }) {
  const music = results?.shotlist?.music;
  if (!Array.isArray(music) || !music.length) return null;
  const plannedSec = Number(results?.cuesheet?.seconds) || filmPlanFor(job).seconds;
  const cuts = measured.cuts || (measured.turns || []).map((at) => ({ at, score: 1 }));
  const cues = cuesOnFilm(music, { plannedSec, filmMs: measured.durationMs, cuts });
  const made = piecesFromCues(cues, measured.durationMs, brief, { seedBase: String(job.id || "") });
  return made ? { cues, ...made } : null;
}

/**
 * deps (optional): { scorer } — `daytonaScorer` unless a test passes a fake;
 * { fetch } — fal's queue and the cue download; { readShots } — the shot list.
 */
export async function runScoreStage({ job, results, env, attempt = 1, model }, deps = {}) {
  const scorer = deps.scorer || daytonaScorer;
  const fetchFn = deps.fetch || fetch;
  const pid = job.projectId;
  // The model the score renders on (film-plan.ts FILM_MUSIC); a job from
  // before the choice keeps ElevenLabs.
  const music = filmMusicOf(job.music);

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

    // The report is scratch in the sandbox's /tmp, which does not survive the
    // sandbox stopping — a job that finished long before this read (a Film
    // stopped, then retried) comes back "file not found". Measuring again is
    // cheap: redo it once the attempt has moved on, rather than failing forever.
    let report;
    try {
      report = await scorer.readMeasure(env, m.jobId, m.outPath);
    } catch (err) {
      const why = String(err?.message || err || "the report is gone").slice(0, 300);
      if ((m.attempt || 1) < attempt) {
        const started = await scorer.startMeasure(env, { filmKey: directorKey(pid, filmFile) });
        state.measure = { ...started, attempt, status: "running", error: null };
        spend += FILM_RATES_USD.sandboxMinute;
        return pending("Measuring the kept film again — the last measurement was lost");
      }
      throw fail(`Reading the film's measurement failed — ${why}`);
    }
    const measured = withDucks(parseMeasurement(report));
    state.measured = {
      durationMs: measured.durationMs,
      hasAudio: measured.hasAudio,
      videoCodec: measured.videoCodec,
      // Every cut, kept (rounded) — the story moments snap to them; `turns` are
      // the hardest few, what the fallback plan splits at.
      cuts: measured.cuts.map((c) => ({ at: Math.round(c.at * 10) / 10, score: Math.round(c.score * 100) / 100 })),
      turns: pickTurns(measured.cuts, measured.durationMs),
      ducks: measured.ducks,
    };
  }
  const { durationMs } = state.measured;

  // ── 2. The score: planned from the cues (or the measurement), rendered ────
  if (!state.pieces) {
    if (state.plan) {
      // A step written before pieces existed: its one cue is piece 0.
      state.pieces = [wholeFilmPiece(state.plan, durationMs, state.cue)];
    } else {
      const series = seriesId ? await readSeries(env, pid, seriesId) : null;
      state.brief = await briefFor({ job, results, series, model });
      const made = piecesForCues({ job, results, measured: state.measured, brief: state.brief });
      if (made) {
        state.cues = made.cues;
        state.pieces = made.pieces;
        state.silences = made.silences;
        state.planBy = "cues";
      } else {
        state.moments = await momentsFor({ job, results, env, measured: state.measured }, deps);
        const written = await writeScorePlan({
          model,
          brief: state.brief,
          filmMs: durationMs,
          moments: state.moments,
          ducks: state.measured.ducks,
          turns: state.measured.turns,
        });
        let plan;
        if (written) {
          plan = written.plan;
          state.silences = written.silences;
          state.planBy = "writer";
        } else {
          plan = planFromFilm({ brief: state.brief, filmMs: durationMs, turns: state.measured.turns });
          state.silences = [];
          state.planBy = "picture";
        }
        state.pieces = [wholeFilmPiece(plan, durationMs)];
      }
    }
    state.plan = state.pieces[0].plan;
  }

  // Every piece rendered on the platform key, polled across alarms. A render
  // that failed on an EARLIER attempt is sent again; the others are kept.
  const pieces = [...state.pieces];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    let r = piece.render;
    if (r?.status === "running") {
      // Polled on the model it was SENT to (a render from before `model` was kept is ElevenLabs).
      const polled = await pollCue(env, pid, r.requestId, { seriesId, key, model: r.model || "elevenlabs" }, fetchFn);
      if (polled.status === "done") {
        r = { ...r, status: "done", file: polled.file, url: polled.url, seconds: polled.seconds ?? piece.lengthMs / 1000, pieceId: polled.pieceId };
      } else if (polled.status === "error") {
        r = { ...r, status: "error", error: polled.error };
      } else {
        r = { ...r, status: "running", queue: polled.queue ?? null };
      }
    }
    if (!r || redo(r)) {
      // An eviction between the submit and the step's commit left a render parked
      // for this piece — pick it up rather than pay for a second one.
      const parked = !r ? await pendingCueFor(env, pid, job.id, i) : null;
      if (parked) {
        r = { requestId: parked.requestId, model: parked.model || "elevenlabs", attempt, status: "running", chunks: piece.plan.chunks.length };
      } else {
        const sent = await submitCue(env, pid, {
          seriesId,
          plan: piece.plan,
          filmMs: piece.lengthMs,
          key,
          model: music,
          extra: { filmId: job.id, piece: i },
        }, fetchFn);
        if (!sent.ok) {
          throw fail(`fal refused ${pieces.length > 1 ? `piece ${i + 1} of the score` : "the cue"}: ${sent.error}${sent.errors ? ` — ${sent.errors.map((e) => e.message).join("; ")}` : ""}`);
        }
        spend += renderCostUsd(planTotalMs(piece.plan), sent.model);
        r = { requestId: sent.requestId, model: sent.model, attempt, status: "running", chunks: piece.plan.chunks.length };
      }
    }
    pieces[i] = { ...piece, render: r };
  }
  state.pieces = pieces;
  // The first piece is the cue, for every reader that knows one.
  state.cue = pieces[0].render;
  const failed = pieces.find((p) => p.render.status === "error");
  if (failed) {
    const which = pieces.length > 1 ? `Piece ${failed.index + 1} of the score` : "The cue render";
    throw fail(`${which} failed (request ${failed.render.requestId}) — ${String(failed.render.error || "fal failed it").slice(0, 400)}`);
  }
  const waiting = pieces.filter((p) => p.render.status === "running");
  if (waiting.length) {
    if (pieces.length === 1) {
      const q = waiting[0].render.queue;
      return pending(`Writing the cue — ${clock(durationMs)} in ${state.plan.chunks.length} chunks${q ? ` (${q.toLowerCase().replace(/_/g, " ")})` : ""}`);
    }
    return pending(`Writing the score — ${pieces.length} pieces, ${pieces.length - waiting.length} of ${pieces.length} done`);
  }

  // ── 3. Mix it under the picture, and file the scored film ──────────────────
  const byCues = state.planBy === "cues";
  let mix = state.mix;
  if (mix?.status === "running") {
    const polled = await scorer.poll(env, mix.jobId);
    mix = { ...mix, status: polled.status, error: polled.error || null };
  }
  if (redo(mix)) {
    const file = scoredName(sittingId);
    // The ducks AND the silences: each silence mutes the bed, faded out and back in.
    const settings = { ducks: state.measured.ducks, spans: silenceSpans(state.silences || []) };
    const where = byCues
      ? {
        cues: pieces.map((p) => ({
          key: directorKey(pid, p.render.file),
          offsetMs: p.startMs,
          durationMs: p.lengthMs,
          fadeInSec: p.fadeInSec,
          fadeOutSec: p.fadeOutSec,
        })),
      }
      : { cueKey: directorKey(pid, pieces[0].render.file) };
    const jobId = await scorer.startMix(env, {
      filmKey: directorKey(pid, filmFile),
      ...where,
      outKey: directorKey(pid, file),
      durationMs,
      hasAudio: state.measured.hasAudio,
      // Not H.264 (the Sitting records VP9) → the mix re-encodes the picture.
      videoCodec: state.measured.videoCodec,
      mix: settings,
    });
    mix = { jobId, file, settings, attempt, status: "running", error: null };
    spend += FILM_RATES_USD.sandboxMinute;
  }
  state.mix = mix;
  if (mix.status === "error") throw fail(`Mixing the ${byCues ? "score" : "cue"} under the film failed — ${String(mix.error || "the sandbox failed").slice(0, 400)}`);
  if (mix.status === "running") {
    return pending(`Laying the ${byCues && pieces.length > 1 ? `${pieces.length} pieces` : "cue"} under the picture — the picture copied, not re-encoded`);
  }

  if (!(await env.BUCKET.head(directorKey(pid, mix.file)))) {
    throw fail("The mix finished but uploaded no scored film.");
  }
  const cue = pieces[0].render;
  const filed = await fileScoredFilm(env, pid, {
    sittingId,
    seriesId,
    name: mix.file,
    plan: state.plan,
    cueFile: cue.file,
    cueUrl: cue.url,
    mix: { ...DEFAULT_MIX, ...mix.settings },
    musicStyle: state.brief,
    ...(byCues
      ? {
        pieces: pieces.map((p) => ({
          file: p.render.file, url: p.render.url, offsetMs: p.startMs, lengthMs: p.lengthMs, plan: p.plan, cues: p.cues,
        })),
      }
      : {}),
  });
  if (!filed.ok) throw fail(`The kept sitting ${sittingId} is gone — the scored film was not filed.`);

  state.url = directorUrl(mix.file);
  state.file = mix.file;
  const quiet = (state.silences || []).length;
  const summary = byCues
    ? `${piecesSummary(pieces, state.silences || [])} · scored film filed beside the sitting`
    : `Cue ${clock(cue.seconds * 1000)} in ${state.plan.chunks.length} chunks${quiet ? ` · ${quiet} silence${quiet === 1 ? "" : "s"}` : ""} · scored film filed beside the sitting`;
  return { summary, result: state, spend };
}
