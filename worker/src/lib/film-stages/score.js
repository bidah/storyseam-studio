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
//   2. CUE — the plan is WRITTEN, the way the score-film skill writes one by
//      hand: the shot list's story moments (one per beat / scene change) are
//      laid on the MEASURED clock (`storyMoments` → `momentsOnFilm`: scaled by
//      measured/planned, then snapped to the real picture cut where the moment
//      landed), and the writing model gets them with the brief, the measured
//      length and the dialogue windows. It answers the chunks — sections named
//      for what that stretch IS, what arrives and what leaves, and which stretches
//      are SILENCE ("we don't want music all the time"). Pure code repairs the
//      arithmetic (`repairScorePlan`: exact length, chunk min/max/count, silence
//      rules). A model that fails or answers garbage falls back to the old
//      mechanical plan (`planFromFilm`: the brief, split at the hardest cuts) —
//      the Film is never failed over its music being plain. The plan goes to
//      ElevenLabs Music on fal on the PLATFORM key (`env.FAL_KEY`, ADR 0003)
//      through the same helpers the Musicalized routes run
//      (lib/musicalized-cue.js), polled to completion; the mp3 is filed on the
//      Series like any cue.
//   3. MIX — a second detached job lays the cue under the picture (`-c:v copy`,
//      the film's own audio at full level, the bed faded in and ducked, AAC,
//      faststart mp4) and uploads it; the scored film is filed BESIDE the
//      sitting on its kept row (`scoredFile`). The unscored sitting is only
//      read — it is kept, untouched.
//
// ── Silences, twice ────────────────────────────────────────────────────────
// ElevenLabs cannot render literal silence, so a silence exists in two layers:
// in the PLAN it is a chunk (`[Held breath]`) asking for near silence and
// forbidding drums, melody and pads — so the music around it is written
// knowing it stops there; in the MIX its span (`silenceSpans`: -80 dB, 1.5 s
// linear ramps out and back in) actually mutes the bed. The spans ride in the
// mix settings to ffmpeg's volume expression and are filed with the scored film.
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
//              plan, brief, planBy: 'writer' | 'picture',
//              moments: [{ at, planned, title, what, dialogue, snapped }],  ← story, measured clock
//              silences: [{ from, to, section }],                           ← seconds, film clock
//              measured: { durationMs, hasAudio, videoCodec, cuts, turns, ducks },
//              measure: {jobId…}, mix: {jobId…} }
//
// ── Across alarms and retries ──────────────────────────────────────────────
// The stage's state is its own step result. Each call does what is due and
// answers `{ pending: true }` until the scored film is filed. A step that
// failed THROWS; the runner retries once, and the retry redoes exactly the
// step that failed on the earlier attempt (the Stills stage's rule).
import { readSeries, readSittings, directorUrl } from "../director.js";
import { readDoc } from "../docs.js";
import { normalizeShot } from "../shots.js";
import { FILM_RATES_USD } from "../film-plan.ts";
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
    const plannedSec = Number(results?.cuesheet?.seconds) || filmPlanFor(job).seconds;
    const cuts = measured.cuts || (measured.turns || []).map((at) => ({ at, score: 1 }));
    return momentsOnFilm(storyMoments(shots, plannedSec), { plannedSec, filmMs: measured.durationMs, cuts });
  } catch {
    return [];
  }
}

/**
 * deps (optional): { scorer } — `daytonaScorer` unless a test passes a fake;
 * { fetch } — fal's queue and the cue download; { readShots } — the shot list.
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
      // Every cut, kept (rounded) — the story moments snap to them; `turns` are
      // the hardest few, what the fallback plan splits at.
      cuts: measured.cuts.map((c) => ({ at: Math.round(c.at * 10) / 10, score: Math.round(c.score * 100) / 100 })),
      turns: pickTurns(measured.cuts, measured.durationMs),
      ducks: measured.ducks,
    };
  }
  const { durationMs } = state.measured;

  // ── 2. The cue: planned from the measurement, rendered on the platform key ─
  if (!state.plan) {
    const series = seriesId ? await readSeries(env, pid, seriesId) : null;
    state.brief = await briefFor({ job, results, series, model });
    state.moments = await momentsFor({ job, results, env, measured: state.measured }, deps);
    const written = await writeScorePlan({
      model,
      brief: state.brief,
      filmMs: durationMs,
      moments: state.moments,
      ducks: state.measured.ducks,
      turns: state.measured.turns,
    });
    if (written) {
      state.plan = written.plan;
      state.silences = written.silences;
      state.planBy = "writer";
    } else {
      state.plan = planFromFilm({ brief: state.brief, filmMs: durationMs, turns: state.measured.turns });
      state.silences = [];
      state.planBy = "picture";
    }
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
    // The ducks AND the silences: each silence mutes the bed, faded out and back in.
    const settings = { ducks: state.measured.ducks, spans: silenceSpans(state.silences || []) };
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
  const quiet = (state.silences || []).length;
  const summary = `Cue ${clock(cue.seconds * 1000)} in ${state.plan.chunks.length} chunks${quiet ? ` · ${quiet} silence${quiet === 1 ? "" : "s"}` : ""} · scored film filed beside the sitting`;
  return { summary, result: state, spend };
}
