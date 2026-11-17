// The Film job — what turns an Auto prompt into a Film, one stage at a time.
//
// CONTEXT.md › Auto: NOT a chat. A job on the Worker runs every step in order
// and shows progress on the Auto surface; nothing depends on the author's tab
// (ADR 0001). The job lives in a Durable Object, one per project
// (`FilmJobs`, worker/src/film-job-do.js), which only stores it and drives it
// with alarms. Everything the job DOES is here, as plain functions with their
// side effects injected — so a Vitest can run a stage against a fake model
// without a Durable Object, a network, or Groq.
//
// ── Shape (later slices EXTEND this, never reshape it) ─────────────────────
//
//   job  = { id, prompt, seconds?, style?, engine? ('seedance' — the story flow on Seedance 2.5;
//            'h3' — the same on MiniMax H3; absent = the Director),
//            writer? ('glm' | 'qwen' | 'kimi' | 'claude' — the LLM that writes it; absent = the Worker's legacy AUTO_WRITER),
//            resolution? ('720p' — what the video renders at; absent = 480p),
//            score? (false — no Score stage; absent = the film is scored),
//            depth? ('deep' — the writers' room reads the script; absent = fast),
//            specialists? (the room's passes, film-plan.ts DEFAULT_DEEP_SPECIALISTS when none),
//            voices? ('video' | 'seedaudio' | 'elevenlabs' — the Voices stage after
//            the sheets, plus the Director's Dialogue stage after its Stills,
//            film-plan.ts › Voices; absent = no stage),
//            status: 'running'|'awaiting-confirm'|'done'|'stopped'
//            |'refused'|'declined', error, projectId, episodeId, userId,
//            auto, createdAt, updatedAt, steps: [step],
//            spend: { [stageKey]: dollars }, stopped?: { stage, label, reason,
//            kept: [{ key, label, summary }], spent },
//            confirm?: { status: 'awaiting'|'confirmed'|'declined', after,
//            summary, plan, askedAt, answeredAt },
//            film?, spent?, allowance? (set when `done` — see "The Film"),
//            retries?: [{ stage, label, reason, at, repaired? }] (retryFilm) }
//   step = { key, label, status: 'running'|'retrying'|'done'|'failed',
//            startedAt, endedAt, summary, result, error, failures, pending?,
//            attemptBase? (attempts made before a retry) }
//
// `steps` grows as stages START — a card appears when its step starts, so the
// surface never draws a stage that hasn't begun. `summary` is one line for the
// card; `result` is the stage's structured output (what the card shows in full,
// and what LATER stages read through `ctx.results[key]`).
//
// ── Stages ─────────────────────────────────────────────────────────────────
//
// FILM_STAGES is an ordered list; the job runs them in order, one per
// `advanceFilm` call: `look` (which house look — chosen, or the premise
// classified), `world` ("Idea + World"), then in order: sheets → shotlist → cuesheet → run → stills →
// sitting → score. A stage is
//
//   { key, label, paid?: true, run(ctx) → { summary, result, spend? } }
//
// ctx = { job, results, attempt (1|2), env, model, saveWorld }. `spend` is what
// the stage cost StorySeam, in dollars; a stage that throws after paying for
// something attaches it as `err.spend`. Both are summed into `job.spend[key]`.
// `paid` marks a stage that spends money (sheets, clips, the sitting, scoring);
// it is descriptive — EVERY stage retries once, because a flaky writing call is
// as worth one more try as a flaky render, and one rule is easier to trust.
//
// ── Pending stages ─────────────────────────────────────────────────────────
//
// A stage that waits on something slow (fal renders clips for minutes) returns
// `{ pending: true, summary, result, spend? }` instead of finishing: the step
// stays `running` with `pending: true`, its summary/result update the card
// (step.progress, only when they changed), its spend is counted, and the job
// is advanced again after PENDING_POLL_MS (the DO asks `nextAlarmDelay`). A
// pending answer is NOT a failure and does not use up the retry. The stage
// keeps its own state somewhere durable and picks it up on the next call.
//
// ── Retry once, then stop ──────────────────────────────────────────────────
//
// A stage that throws is retried ONCE, on the next advance (the card says
// "Retrying"). A second throw STOPS the job: status `stopped` (our side failed;
// everything already made is kept, nothing is deleted), `job.stopped` names the
// stage, the reason, the kept outputs and the spend — what the Stopped card
// shows. A stopped Film never counts against the allowance (allowanceKindOf).
//
// ── Events ─────────────────────────────────────────────────────────────────
//
// Every transition is committed (persisted, THEN broadcast) through
// `deps.commit(job, event)`. The DO broadcasts it on the project's existing
// live-sync `data` channel as `{ resource: "auto", kind, filmId, step, job }`
// — no new EventSource. Kinds, in the order a job emits them:
//
//   film.queued? → film.started → (step.started → step.progress* →
//     step.retrying? → step.done | step.failed)… → film.done | film.stopped
//
// A stopped Film can be RETRIED from the step that stopped it (`retryFilm`):
// film.stopped → film.retried → (the failed step runs again…) → …
//
// `film.refused` replaces film.started when a QUEUED Film reaches the front
// and the kill switch or the allowance says no (lib/film-queue.js).
//
// ── The Auto toggle and the one confirm card (#65) ────────────────────────
//
// `job.auto` is the owner's Auto toggle (lib/auto-settings.js), read when the
// job STARTS. On, nothing asks. Off, the job pauses ONCE, right after the
// last story stage (`confirmAfterFor` — the Script, or a Deep Film's room) and
// before any paid stage runs: status
// `awaiting-confirm`, `job.confirm` holds the Film plan (planFilm — length,
// reels, sheets, estimate per stage and total) the confirm card draws.
//
//   … step.done(world) → film.awaiting-confirm → film.confirmed → step.started…
//                                             ↘ film.declined (the end)
//
// A declined Film has spent nothing after the World and never counts
// (allowanceKindOf is `failed` for anything but `done`); the queue moves on.
// The confirm card is NOT a step: steps map 1:1 onto FILM_STAGES by position.
//
// ── Allowance ──────────────────────────────────────────────────────────────
//
// `startFilm` checks the kill switch (autoAvailable) and the Film allowance
// (checkAllowance) BEFORE anything is created; a refusal starts nothing.
// countFilm runs in `completeFilm`, once the score is filed and the job turns
// `done` — never for a stopped, declined or refused job. It is idempotent on
// the job id, so a completion delivered twice (the DO evicted between the
// count and the `film.done` commit) still counts once.
//
// ── The Film (#71) ─────────────────────────────────────────────────────────
//
// When the last stage (score) completes, `completeFilm` turns the job `done`:
//
//   job.film  = { url, file, unscored: { file, url }, seconds, seriesId,
//                 sittingId, title, idea }      ← url is the SCORED film
//   job.spent = totalSpend(job)                 ← beside job.spend (per stage)
//   job.allowance = { counted, duplicate?, kind } | { error }
//
// and registers the Film as a project file: the kept sitting row it was scored
// on is stamped `film: { id, title, completedAt }`, which is what `/api/pool`
// (the Editor's media pool, the agent's list_media_pool) lists as
// "Film — <title>". `film.done` carries it all.
import { writerModel } from "./writer.js";
import { runScriptStage } from "./film-stages/script-flow.js";
import { runRoomStage } from "./film-stages/room.js";
import { SPECIALIST_BY_ID, isSpecialistId } from "./specialists.ts";
import { autoAvailable } from "./auto-availability.js";
import { checkAllowance, countFilm } from "./film-allowance.js";
import { readIndex, readSeries, repairSeries, updateSittings } from "./director.js";
import { runWithContext } from "./request-context.js";
import { WORLD_SHAPE } from "./auto-prompts.generated.js";
import { runLookStage } from "./film-stages/look.js";
import { runSheetsStage } from "./film-stages/sheets.js";
import { runShotlistStage } from "./film-stages/shotlist.js";
import { briefMessages, parseBrief } from "./film-stages/brief.js";
import { filmSecondsFor } from "./film-stages/script.js";
import { runCueSheetStage } from "./film-stages/cuesheet.js";
import { runRunStage } from "./film-stages/run.js";
import { runStillsStage } from "./film-stages/stills.js";
import { runSittingStage } from "./film-stages/sitting.js";
import { runScoreStage } from "./film-stages/score.js";
import { readAutoSettings } from "./auto-settings.js";
import { settleFilmStudio } from "./film-plugins.js";
import { runStoryFlowSheetsStage } from "./film-stages/story-flow/sheets.js";
import { runStoryFlowShotlistStage } from "./film-stages/story-flow/shotlist.js";
import { runStoryFlowPromptsStage } from "./film-stages/story-flow/prompts.js";
import { runStoryFlowRunStage } from "./film-stages/story-flow/run.js";
import { runStoryFlowStitchStage } from "./film-stages/story-flow/stitch.js";
import { runVoicesStage } from "./film-stages/story-flow/voices.js";
import { runDialogueStage } from "./film-stages/dialogue.js";
import { runH3PromptsStage } from "./film-stages/h3/prompts.js";
import { runH3RunStage } from "./film-stages/h3/run.js";
import { planH3, filmScoreOf, filmVoicesOf, isStoryEngine, newFilmMusic, FILM_MUSIC, FILM_MUSIC_IDS, FILM_VOICES, FILM_VOICE_IDS } from "./film-plan.ts";
import {
  planFilm, planStoryFlow, formatLength, filmStepsFor, FILM_ENGINES, FILM_STYLES, FILM_STYLE_IDS, FILM_WRITERS, FILM_WRITER_IDS, DEFAULT_FILM_WRITER,
  FILM_DEPTHS, FILM_DEPTH_IDS, DEFAULT_DEEP_SPECIALISTS, MAX_REFERENCE_SHEETS, MAX_STORY_FLOW_SHEETS,
  FILM_RESOLUTIONS, DEFAULT_FILM_RESOLUTION,
} from "./film-plan.ts";

/**
 * A Film length someone CHOSE (the /director-story gear, make_film's `seconds`)
 * → null when it is fine, else why not. Absent is fine — the prompt, or the
 * 2:00 default, decides — but a value that is not exactly one of the 30s steps
 * is refused, not rounded: a control sent it, and rounding would hide the bug.
 */
/** A look someone CHOSE must be one of the house looks; none is fine. → message | null */
export function checkFilmStyle(style) {
  if (style === undefined || style === null || style === "") return null;
  if (FILM_STYLE_IDS.includes(style)) return null;
  return `A Film's look is one of ${FILM_STYLES.map((s) => `${s.id} (${s.label})`).join(", ")}.`;
}

export function checkFilmSeconds(seconds, engine = null) {
  if (seconds === undefined || seconds === null) return null;
  const steps = filmStepsFor(engine);
  if (typeof seconds === "number" && steps.includes(seconds)) return null;
  return `A Film is ${steps.map(formatLength).join(", ")} long — choose one of those.`;
}

/**
 * Which pipeline makes the Film: the Director (`/director-story`, the default)
 * or Seedance 2.5 (`/story-flow` — `seedance`). The ROUTE chooses it. → message | null
 */
/** What the video renders at (film-plan.ts FILM_RESOLUTIONS); none is 480p. → message | null */
export function checkFilmResolution(resolution) {
  if (resolution === undefined || resolution === null || resolution === "") return null;
  if (FILM_RESOLUTIONS.includes(resolution)) return null;
  return `A Film renders at one of ${FILM_RESOLUTIONS.join(", ")}.`;
}

/** The LLM that writes the Film (film-plan.ts FILM_WRITERS); none is the default. → message | null */
export function checkFilmWriter(writer) {
  if (writer === undefined || writer === null || writer === "") return null;
  if (FILM_WRITER_IDS.includes(writer)) return null;
  return `A Film is written by one of ${FILM_WRITERS.map((w) => `${w.id} (${w.label})`).join(", ")}.`;
}

/** How deep the story work goes (film-plan.ts FILM_DEPTHS); none is fast. → message | null */
export function checkFilmDepth(depth) {
  if (depth === undefined || depth === null || depth === "") return null;
  if (FILM_DEPTH_IDS.includes(depth)) return null;
  return `A Film's depth is one of ${FILM_DEPTHS.map((d) => `${d.id} (${d.label})`).join(", ")}.`;
}

/** The room's passes: every id one of the fifteen specialists; none is the default room. → message | null */
export function checkFilmSpecialists(specialists) {
  if (specialists === undefined || specialists === null) return null;
  if (!Array.isArray(specialists)) return "A Film's specialists is a list of specialist ids.";
  const bad = specialists.filter((id) => !isSpecialistId(id));
  if (bad.length) return `Not a specialist: ${bad.map(String).join(", ")}.`;
  return null;
}

/** The room a Deep Film runs: the chosen passes in ROSTER order (the stage order is craft), else the default room. */
export function roomFor(job) {
  const chosen = Array.isArray(job?.specialists) ? job.specialists.filter(isSpecialistId) : [];
  const ids = chosen.length ? chosen : [...DEFAULT_DEEP_SPECIALISTS];
  return [...new Set(ids)].sort((a, b) => SPECIALISTS_INDEX.get(a) - SPECIALISTS_INDEX.get(b));
}
const SPECIALISTS_INDEX = new Map([...SPECIALIST_BY_ID.keys()].map((id, i) => [id, i]));

export function checkFilmEngine(engine) {
  if (engine === undefined || engine === null || engine === "") return null;
  if (FILM_ENGINES.includes(engine)) return null;
  return `A Film is made by one of ${FILM_ENGINES.join(", ")}.`;
}

export function checkFilmScore(score) {
  if (score === undefined || score === null || typeof score === "boolean") return null;
  return "A Film's score is on (absent) or false.";
}

/** The score's model (film-plan.ts FILM_MUSIC); absent is the default. → message | null */
export function checkFilmMusic(music) {
  if (music === undefined || music === null || music === "") return null;
  if (FILM_MUSIC_IDS.includes(music)) return null;
  return `A Film's score is rendered on one of ${FILM_MUSIC.map((x) => `${x.id} (${x.label})`).join(", ")}.`;
}

/** The Voices pass (film-plan.ts FILM_VOICES); none is fine (no stage). → message | null */
export function checkFilmVoices(voices) {
  if (voices === undefined || voices === null || voices === "") return null;
  if (FILM_VOICE_IDS.includes(voices)) return null;
  return `A Film's voices are made by one of ${FILM_VOICES.map((x) => `${x.id} (${x.label})`).join(", ")}.`;
}

export const FILM_EVENT_RESOURCE = "auto";
export const FILM_EVENTS = Object.freeze([
  "film.queued", "film.started", "film.refused", "step.started", "step.retrying",
  "step.done", "step.failed", "film.done", "film.stopped",
  "film.awaiting-confirm", "film.confirmed", "film.declined",
  "step.progress", "film.retried",
]);

/** How long a pending stage waits before it is asked again (fal takes minutes). */
export const PENDING_POLL_MS = 15_000;

/** When the DO should run the job's next attempt: later for a pending stage, else now. */
export const nextAlarmDelay = (job) => {
  const step = job?.steps?.at(-1);
  if (!step?.pending) return 0;
  // A stage with more of its own work to do right away (the room's next pass) says so.
  return Number.isFinite(step.pollMs) ? Math.max(0, step.pollMs) : PENDING_POLL_MS;
};

/** The stage after which an Auto-off job pauses to ask: the last unpaid story stage, so the script is on the table. */
export const CONFIRM_AFTER = "script";
/** The stage this job pauses after: the last story stage its list HAS (a list without one — tests — asks after the World). */
export function confirmAfterFor(job, stages = stagesFor(job)) {
  for (const key of ["room", CONFIRM_AFTER, "world"]) if (stages.some((s) => s.key === key)) return key;
  return CONFIRM_AFTER;
}

/** A job that holds the project: a new prompt queues behind it. */
export const isActive = (job) => job?.status === "running" || job?.status === "awaiting-confirm";
export const MAX_PROMPT_CHARS = 4000;

const iso = (now) => new Date(now ?? Date.now()).toISOString();
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

// ── The World stage ─────────────────────────────────────────────────────────

// The Auto-only half of the prompt. The World's SHAPE comes from the
// world-creation playbook (WORLD_SHAPE, vendored by `npm run auto:sync`) so the
// chat agent and this job write the same World; what differs is the job: here
// the prompt IS the brief and nothing asks, so the model decides.
export function worldMessages(prompt, brief = null) {
  const system = [
    "You are the writing room of StorySeam's Auto pipeline. An author typed one prompt; you turn it into",
    "the IDEA (what the prompt amounts to, stated as the thing to build — two or three sentences) and the",
    "WORLD derived from it. Nobody will be asked anything: decide every detail yourself, concretely, in",
    "service of a short film of two to four and a half minutes. Keep the cast small (2–4 characters) and",
    "the places few (1–4) — every character and place will be drawn as a model sheet and must reappear",
    "consistently. Write `appearance` and each place's `description` as visual design notes a painter",
    "could draw from (silhouette, colours, materials, light).",
    "",
    "The World's shape, as the studio's World bible defines it:",
    "",
    WORLD_SHAPE,
    "",
    "Places are the World's `locations`: `{ name, description }`.",
    "",
    "PROPS are apart from the characters. A character's `appearance` is body, face, hair and clothing ONLY —",
    "never an object they hold, carry or use (no weapon, bag, tool, phone, lantern, instrument, book, cup…).",
    "Every object that matters to the story — one a character carries, uses, loses, finds or hands over — is a",
    "PROP in `props`: `{ name, description, owner }`. `description` is a visual design note of the object",
    "alone (shape, size, material, colours, wear); `owner` is the character who carries it, by name EXACTLY,",
    "or empty. 0–4 props; each is drawn as its own sheet and bound into every shot it appears in.",
    "Ignore sheetImage and voiceRef — they are attached later by other steps.",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "idea": string, "world": { "title": string, "logline": string,',
    '  "map": { "world", "protagonist", "antagonist", "stakes", "theme" },',
    '  "depth": { "premise", "wantVsNeed", "conflict", "obstacles", "structure" },',
    '  "characters": [{ "name", "archetype", "role", "want", "need", "traits", "arc", "voice", "appearance" }],',
    '  "locations": [{ "name", "description" }],',
    '  "props": [{ "name", "description", "owner" }] } }',
    "Every value is a string except the three arrays.",
  ].join("\n");
  // The brief (./film-stages/brief.js): a story prompt's places and people
  // are the author's, and the World must hold every one of them — Star Ronin's
  // "city at night" and "empty corner" became one alley, so its opening had
  // nowhere to happen.
  const story = brief?.kind === "story";
  const need = [
    ...(story && brief.places?.length
      ? ["", `The author's story moves through these places: every one is a World location (name it plainly; up to 6 places): ${brief.places.join(" · ")}.`]
      : []),
    ...(brief?.characters?.length
      ? ["", `The author's characters, each one in the cast as they describe them: ${brief.characters.map((c) => `${c.name}${c.note ? ` (${c.note})` : ""}`).join("; ")}.`]
      : []),
    ...(story ? ["The author TOLD the story (below): the Idea restates THEIR story, it does not invent another."] : []),
  ];
  return [
    { role: "system", content: need.length ? `${system}\n${need.join("\n")}` : system },
    { role: "user", content: `The author's prompt:\n\n${prompt}` },
  ];
}

// The model's answer → `{ idea, world }`, or a throw naming what was missing.
// Only the fields the World format knows are forwarded; saveWorld drops the rest
// anyway, but a stray `sheetImage` from a model must never unlink a real one.
export function parseIdeaWorld(answer) {
  const idea = str(answer?.idea);
  const w = answer?.world && typeof answer.world === "object" ? answer.world : null;
  if (!idea) throw new Error("The writing model returned no Idea.");
  if (!w) throw new Error("The writing model returned no World.");
  const pick = (o, keys) =>
    Object.fromEntries(keys.map((k) => [k, str(o?.[k])]).filter(([, v]) => v));
  const characters = (Array.isArray(w.characters) ? w.characters : [])
    .map((c) => pick(c, ["name", "archetype", "role", "want", "need", "traits", "arc", "voice", "appearance"]))
    .filter((c) => c.name);
  const locations = (Array.isArray(w.locations) ? w.locations : [])
    .map((l) => pick(l, ["name", "description"]))
    .filter((l) => l.name);
  const props = (Array.isArray(w.props) ? w.props : [])
    .map((p) => pick(p, ["name", "description", "owner"]))
    .filter((p) => p.name);
  if (!characters.length) throw new Error("The writing model returned a World with no characters.");
  return {
    idea,
    world: {
      title: str(w.title),
      logline: str(w.logline),
      map: pick(w.map, ["world", "protagonist", "antagonist", "stakes", "theme"]),
      depth: pick(w.depth, ["premise", "wantVsNeed", "conflict", "obstacles", "structure"]),
      characters,
      locations,
      props,
    },
  };
}

async function runWorldStage({ job, model, env, saveWorld }) {
  // The prompt read first: what kind it is, and a story's beats, lines and places.
  let brief = null;
  try {
    brief = parseBrief(await model.json({ messages: briefMessages(job.prompt), maxTokens: 4000, temperature: 0.2 }), job.prompt);
  } catch (err) {
    console.warn("film world: the brief failed; the prompt is read as a seed", job.id, String(err?.message || err));
  }
  const answer = await model.json({ messages: worldMessages(job.prompt, brief), maxTokens: 8000, temperature: 0.8 });
  const { idea, world } = parseIdeaWorld(answer);
  await saveWorld(env, job.projectId, { ...world, source: "auto" });
  const characters = world.characters.map((c) => ({ name: c.name, role: c.role || c.archetype || "" }));
  const places = world.locations.map((l) => ({ name: l.name, description: l.description || "" }));
  const props = world.props.map((p) => ({ name: p.name, owner: p.owner || "" }));
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  // The prompt names a length the Film's setting does not have ("a one-minute
  // trailer" made at 2:00): said, not silently resolved — the quote and the
  // steps were fixed when the Film was made.
  const planned = filmSecondsFor(job);
  const lengthNote = brief?.seconds && Math.abs(brief.seconds - planned) >= 15
    ? `The prompt asks for ${formatLength(brief.seconds)}; this Film is set to ${formatLength(planned)}.`
    : null;
  return {
    summary: `${world.title || "World"} — ${n(characters.length, "character")}, ${n(places.length, "place")}${props.length ? `, ${n(props.length, "prop")}` : ""}${brief ? ` · ${brief.kind === "story" ? `the author's story, ${n(brief.beats.length, "beat")}` : "a seed prompt"}` : ""}${lengthNote ? ` · ${lengthNote}` : ""}`,
    result: { idea, title: world.title, logline: world.logline, characters, places, props, ...(brief ? { brief } : {}), ...(lengthNote ? { lengthNote } : {}) },
  };
}

/** The ordered stages. Later slices append; keys are stable public ids. */
export const FILM_STAGES = Object.freeze([
  // The look first: every later stage is written and drawn in it.
  { key: "look", label: "Look", run: (ctx) => runLookStage(ctx) },
  { key: "world", label: "Idea + World", run: runWorldStage },
  // Each later stage's logic lives in its own module under ./film-stages/.
  { key: "sheets", label: "Reference sheets", run: (ctx) => runSheetsStage(ctx) },
  { key: "shotlist", label: "Shot list", run: (ctx) => runShotlistStage(ctx) },
  { key: "cuesheet", label: "Cue sheet", run: (ctx) => runCueSheetStage(ctx) },
  { key: "run", label: "Shot sheet run", paid: true, run: (ctx) => runRunStage(ctx) },
  { key: "stills", label: "Stills", paid: true, run: (ctx) => runStillsStage(ctx) },
  { key: "sitting", label: "Sitting", paid: true, run: (ctx) => runSittingStage(ctx) },
  // The score reads `results.sitting` (the kept film: sittingId + file) — film-stages/score.js.
  { key: "score", label: "Score", paid: true, run: (ctx) => runScoreStage(ctx) },
]);

/**
 * The STORY FLOW (/story-flow, `job.engine === "seedance"`): the same prompt to
 * Film on Seedance 2.5 — see film-plan.ts › The STORY FLOW. Look and World are
 * the Director flow's own; from the sheets on, every stage is the story flow's
 * (./film-stages/story-flow/). Keys are stable public ids, like FILM_STAGES'.
 */
export const STORY_FLOW_STAGES = Object.freeze([
  { key: "look", label: "Look", run: (ctx) => runLookStage(ctx) },
  { key: "world", label: "Idea + World", run: runWorldStage },
  { key: "sheets", label: "Character, place & prop sheets", paid: true, run: (ctx) => runStoryFlowSheetsStage(ctx) },
  { key: "shotlist", label: "Shot list", run: (ctx) => runStoryFlowShotlistStage(ctx) },
  { key: "prompts", label: "Segment prompts", run: (ctx) => runStoryFlowPromptsStage(ctx) },
  { key: "run", label: "Video run", paid: true, run: (ctx) => runStoryFlowRunStage(ctx) },
  { key: "stitch", label: "Final cut", paid: true, run: (ctx) => runStoryFlowStitchStage(ctx) },
]);

/**
 * The H3 FLOW (`job.engine === "h3"`): the story flow on MiniMax H3 — see
 * film-plan.ts › The H3 FLOW. The sheets, the Shot list and the final cut are
 * the story flow's own (the Shot list reads the H3 skill instead of the
 * Seedance one); the prompts and the video run are H3's (./film-stages/h3/).
 */
export const H3_STAGES = Object.freeze([
  { key: "look", label: "Look", run: (ctx) => runLookStage(ctx) },
  { key: "world", label: "Idea + World", run: runWorldStage },
  { key: "sheets", label: "Character, place & prop sheets", paid: true, run: (ctx) => runStoryFlowSheetsStage(ctx) },
  { key: "shotlist", label: "Shot list", run: (ctx) => runStoryFlowShotlistStage(ctx) },
  { key: "prompts", label: "Segment prompts", run: (ctx) => runH3PromptsStage(ctx) },
  { key: "run", label: "Video run", paid: true, run: (ctx) => runH3RunStage(ctx) },
  { key: "stitch", label: "Final cut", paid: true, run: (ctx) => runStoryFlowStitchStage(ctx) },
]);

/**
 * The SCORE after a story engine's final cut: the Director's Score stage
 * (film-stages/score.js) reads the kept film off `results.sitting`; a story
 * flow's kept film is its `stitch` result, which has the same fields
 * (story-flow/stitch.js), so it is handed over under that name.
 */
export const STORY_SCORE_STAGE = Object.freeze({
  key: "score",
  label: "Score",
  paid: true,
  run: (ctx) => runScoreStage({ ...ctx, results: { ...ctx.results, sitting: ctx.results?.stitch } }),
});

/**
 * The STORY stages every engine shares, right after the World: the Script
 * (film-stages/script.js — the screenplay the Shot list is cut from), and for
 * a Deep Film the writers' room (film-stages/room.js — the chosen specialists
 * read the draft, then it is rewritten on their notes).
 */
export const SCRIPT_STAGE = Object.freeze({ key: "script", label: "Script", run: (ctx) => runScriptStage(ctx) });
export const ROOM_STAGE = Object.freeze({ key: "room", label: "Writers' room", run: (ctx) => runRoomStage(ctx) });

/**
 * The VOICES stage a story engine runs right after its sheets when the job
 * asked for one (`job.voices`, film-plan.ts › Voices): every character
 * auditioned once, the take filed as the voice every segment references
 * (film-stages/story-flow/voices.js). Only when the job carries the setting —
 * steps map onto stages by position, so a job from before never gains a stage.
 */
export const VOICES_STAGE = Object.freeze({ key: "voices", label: "Voices", paid: true, run: (ctx) => runVoicesStage(ctx) });

/**
 * The DIALOGUE stage a Director Film runs after its Stills when it auditioned
 * voices: every spoken beat's lines read by Seed Audio against the speakers'
 * auditions and set as that beat's target audio (film-stages/dialogue.js), so
 * the live Director plays one voice per character instead of inventing a new
 * one every chunk. After the Stills because the reels are fixed by then, and
 * the 8-audio-beat ceiling is per reel.
 */
export const DIALOGUE_STAGE = Object.freeze({ key: "dialogue", label: "Dialogue", paid: true, run: (ctx) => runDialogueStage(ctx) });

const ENGINE_STAGES = { seedance: STORY_FLOW_STAGES, h3: H3_STAGES };

/**
 * The stages a job runs: its engine's, with the story stages after the World,
 * the Voices after the sheets when a story engine asked for them, and the
 * Score last for every engine unless the job switched it off
 * (film-plan.ts › The score).
 */
export function stagesFor(job) {
  const base = ENGINE_STAGES[job?.engine] || FILM_STAGES;
  const at = base.findIndex((s) => s.key === "world") + 1;
  const story = job?.depth === "deep" ? [SCRIPT_STAGE, ROOM_STAGE] : [SCRIPT_STAGE];
  const scored = filmScoreOf(job?.score);
  const tail = base.slice(at).filter((s) => scored || s.key !== "score");
  if (filmVoicesOf(job?.voices, job?.engine)) {
    const sheets = tail.findIndex((s) => s.key === "sheets");
    if (sheets >= 0) tail.splice(sheets + 1, 0, VOICES_STAGE);
    // The Director plays the voices as target audio, placed once the reels are fixed.
    const stills = isStoryEngine(job?.engine) ? -1 : tail.findIndex((s) => s.key === "stills");
    if (stills >= 0) tail.splice(stills + 1, 0, DIALOGUE_STAGE);
  }
  const score = scored && isStoryEngine(job?.engine) ? [STORY_SCORE_STAGE] : [];
  return [...base.slice(0, at), ...story, ...tail, ...score];
}

// ── Job lifecycle ───────────────────────────────────────────────────────────

/** What the surface and the events carry — the job minus who started it. */
export function publicJob(job) {
  if (!job) return null;
  const { userId, ...rest } = job;
  return rest;
}

/**
 * Validate, check the kill switch and the allowance, and — only if all pass —
 * create the job. Creates nothing on a refusal.
 *
 * → `{ ok: true, job }` | `{ ok: false, refusal: { code, message } }`, code
 *   'invalid' | 'busy' | 'paused' | 'unavailable' | 'allowance'.
 */
export async function startFilm(existing, { prompt, seconds, style, engine, writer, resolution, score, music, depth, specialists, voices, userId, projectId, episodeId }, deps = {}) {
  const env = deps.env;
  const text = str(prompt);
  if (!text) return refuse("invalid", "Write a prompt first.");
  const badEngine = checkFilmEngine(engine);
  if (badEngine) return refuse("invalid", badEngine);
  const badScore = checkFilmScore(score);
  if (badScore) return refuse("invalid", badScore);
  const badVoices = checkFilmVoices(voices);
  if (badVoices) return refuse("invalid", badVoices);
  const badMusic = checkFilmMusic(music);
  if (badMusic) return refuse("invalid", badMusic);
  const badLength = checkFilmSeconds(seconds, engine);
  if (badLength) return refuse("invalid", badLength);
  const badStyle = checkFilmStyle(style);
  if (badStyle) return refuse("invalid", badStyle);
  const badWriter = checkFilmWriter(writer);
  if (badWriter) return refuse("invalid", badWriter);
  const badResolution = checkFilmResolution(resolution);
  if (badResolution) return refuse("invalid", badResolution);
  const badDepth = checkFilmDepth(depth);
  if (badDepth) return refuse("invalid", badDepth);
  const badRoom = checkFilmSpecialists(specialists);
  if (badRoom) return refuse("invalid", badRoom);
  if (text.length > MAX_PROMPT_CHARS) {
    return refuse("invalid", `Keep the prompt under ${MAX_PROMPT_CHARS} characters.`);
  }
  if (!userId) return refuse("invalid", "Sign in to make a Film.");
  if (isActive(existing)) {
    return refuse("busy", "A Film is already being made on this project — wait for it to finish.");
  }

  const avail = await (deps.availability || autoAvailable)(env);
  if (!avail.ok) return refuse(avail.paused ? "paused" : "unavailable", avail.reason);

  const allowance = await (deps.allowance || checkAllowance)(env, userId, deps.now?.());
  if (!allowance.ok) return refuse("allowance", allowance.message);

  const { auto } = await (deps.autoSettings || readAutoSettings)(env, userId);

  const at = iso(deps.now?.());
  return {
    ok: true,
    job: {
      id: deps.newId ? deps.newId() : `film-${crypto.randomUUID()}`,
      prompt: text,
      // The chosen length, when one was chosen: it wins over the prompt's.
      ...(seconds != null ? { seconds } : {}),
      // The look, when one was CHOSEN; otherwise the Look stage classifies the
      // premise (film-stages/look.js) and every later stage reads its pick.
      ...(style ? { style } : {}),
      // The pipeline, when it is not the Director's (the route chose it).
      ...(engine && engine !== "director" ? { engine } : {}),
      // The writing model, when it is not the studio's default.
      // Every new Film names its writer; only an explicit `default` still
      // stores none, which is the Worker's legacy AUTO_WRITER (lib/writer.js).
      ...(writer === "default" ? {} : { writer: writer || DEFAULT_FILM_WRITER }),
      // The resolution, when it is not the default 480p.
      ...(resolution && resolution !== DEFAULT_FILM_RESOLUTION ? { resolution } : {}),
      // The score, only when the author switched it OFF.
      ...(score === false ? { score: false } : {}),
      // The score's model — always named on a new Film, so a job stored
      // without one is known to be from before (and keeps ElevenLabs).
      ...(score === false ? {} : { music: newFilmMusic(music) }),
      // The writers' room, when the author asked for one: its passes ride along.
      ...(depth === "deep" ? { depth, specialists: roomFor({ specialists }) } : {}),
      // The Voices pass. Every engine runs it now: the story engines bind the
      // auditions as voice references, the Director plays its lines as target
      // audio (the Dialogue stage). Absent = a Film from before (no stage).
      ...(filmVoicesOf(voices, engine) ? { voices } : {}),
      status: "running",
      error: null,
      projectId: projectId ?? null,
      episodeId: episodeId ?? null,
      userId,
      auto: auto !== false,
      createdAt: at,
      updatedAt: at,
      steps: [],
      spend: {},
    },
  };
}

function refuse(code, message) {
  return { ok: false, refusal: { code, message } };
}

export const event = (kind, job, step) => ({
  resource: FILM_EVENT_RESOURCE,
  kind,
  filmId: job.id,
  step: step?.key ?? null,
  job: publicJob(job),
});

/** Add `amount` (dollars) to `job.spend[key]`; a non-number or <=0 is nothing. */
function addSpend(job, key, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return job;
  const spend = { ...(job.spend || {}) };
  spend[key] = Math.round(((spend[key] || 0) + n) * 1e6) / 1e6;
  return { ...job, spend };
}

/** The whole job's spend so far, in dollars. */
export function totalSpend(job) {
  const sum = Object.values(job?.spend || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  return Math.round(sum * 1e6) / 1e6;
}

/**
 * What a Film's outcome counts as against the allowance (film-allowance.js
 * `countFilm` kinds). Only a finished Film is a `new` one; a stopped, refused
 * or still-running job is `failed` — StorySeam's error is never the author's
 * cost (CONTEXT.md › Film allowance).
 */
export function allowanceKindOf(job) {
  return job?.status === "done" ? "new" : "failed";
}

/**
 * Run the job's NEXT stage attempt and return the new job. A step left
 * `running` or `retrying` (the DO was evicted mid-stage) is run again from its
 * start — an eviction is not a failure and does not use up the retry.
 *
 * Retry once: a stage that throws is marked `retrying` (step.retrying) and the
 * job stays `running`; the NEXT call runs it again. A second throw stops the
 * job (step.failed → film.stopped) — see the header.
 *
 * deps: { env, model: { json(opts) }, saveWorld, commit(job, event), now?,
 *         stages? (default FILM_STAGES — tests pass fake runners) }
 */
export async function advanceFilm(job, deps) {
  if (!job || job.status !== "running") return job;
  const stages = deps.stages || stagesFor(job);
  const now = () => iso(deps.now?.());
  const commit = deps.commit || (async () => {});

  const last = job.steps[job.steps.length - 1];
  const resuming = last?.status === "running" || last?.status === "retrying";
  const stage = resuming ? stages.find((s) => s.key === last.key) : stages[job.steps.length];

  if (!stage) {
    // Every stage is done but the job never turned `done` (evicted between the
    // last step.done and film.done): finish it now. Counting is idempotent.
    job = await completeFilm(job, deps);
    await commit(job, event("film.done", job));
    return job;
  }

  let step = resuming
    ? last
    : { key: stage.key, label: stage.label, status: "running", startedAt: now(), endedAt: null, summary: null, result: null, error: null, failures: 0 };
  job = { ...job, updatedAt: now(), steps: resuming ? job.steps : [...job.steps, step] };
  const replace = (j, s) => ({ ...j, updatedAt: now(), steps: j.steps.map((x) => (x.key === s.key ? s : x)) });
  if (!resuming) await commit(job, event("step.started", job, step));

  const results = Object.fromEntries(job.steps.filter((s) => s.status === "done").map((s) => [s.key, s.result]));
  // `attemptBase` counts the attempts made before a retry (retryFilm), so a
  // retried stage's attempt number keeps rising and it redoes the work that
  // failed on the earlier attempts rather than waiting on it.
  const attempt = (step.attemptBase || 0) + (step.failures || 0) + 1;
  try {
    // Doc writes are attributed and episode-scoped from the request context
    // (lib/request-context.js); a job has no request, so it opens its own.
    const out = await runWithContext(
      { userId: job.userId, caller: "auto", chatId: null, episodeId: job.episodeId || undefined },
      () => stage.run({ job, results, attempt, env: deps.env, model: deps.model, saveWorld: deps.saveWorld }),
    );
    if (out?.pending) {
      // Not finished yet (see "Pending stages"): keep the step running, show
      // its progress, and come back on a later alarm. Not a failure.
      const changed = out.summary !== step.summary || JSON.stringify(out.result ?? null) !== JSON.stringify(step.result);
      step = { ...step, status: "running", pending: true, summary: out.summary ?? step.summary, result: out.result ?? step.result, ...(Number.isFinite(out.pollMs) ? { pollMs: out.pollMs } : {}) };
      job = replace(addSpend(job, stage.key, out.spend), step);
      if (changed || out.spend > 0) await commit(job, event("step.progress", job, step));
      return job;
    }
    step = { ...step, status: "done", pending: false, endedAt: now(), summary: out?.summary ?? null, result: out?.result ?? null, error: null };
    job = replace(addSpend(job, stage.key, out?.spend), step);
    await commit(job, event("step.done", job, step));
  } catch (err) {
    const message = String(err?.message || err);
    // A throwing stage may already have paid for something (err.spend).
    job = addSpend(job, stage.key, err?.spend);
    const failures = (step.failures || 0) + 1;
    if (failures < 2) {
      step = { ...step, status: "retrying", pending: false, failures, error: message };
      job = replace(job, step);
      await commit(job, event("step.retrying", job, step));
      return job;
    }
    step = { ...step, status: "failed", pending: false, failures, endedAt: now(), error: message };
    job = replace(job, step);
    const kept = job.steps
      .filter((s) => s.status === "done")
      .map((s) => ({ key: s.key, label: s.label, summary: s.summary }));
    job = {
      ...job,
      status: "stopped",
      error: `${stage.label}: ${message}`,
      stopped: { stage: stage.key, label: stage.label, reason: message, kept, spent: totalSpend(job) },
    };
    await commit(job, event("step.failed", job, step));
    await commit(job, event("film.stopped", job));
    // The studio for what DID get made: its project's tabs are the steps that
    // finished (lib/film-plugins.js). Best-effort; never fails the stop.
    await (deps.settleStudio || settleFilmStudio)(deps.env, job);
    return job;
  }

  // Auto off: ask once, after the story is written, before anything is paid for.
  if (stage.key === confirmAfterFor(job, stages) && job.auto === false && !job.confirm) {
    const world = stage.key === "world" ? step.result : results.world;
    const confirm = { status: "awaiting", after: stage.key, ...confirmPlan(job, world), askedAt: now(), answeredAt: null };
    job = { ...job, status: "awaiting-confirm", confirm, updatedAt: now() };
    await commit(job, event("film.awaiting-confirm", job));
    return job;
  }

  if (job.steps.length >= stages.length) {
    job = await completeFilm(job, deps);
    await commit(job, event("film.done", job));
  }
  return job;
}

// ── Retry from the failed step ──────────────────────────────────────────────
//
// A Film that stopped at Stills has already paid for its World, sheets and
// clips; starting over re-buys all of them. `retryFilm` instead puts the SAME
// job back to `running` with the failed step running again: every earlier
// step's result and the whole `spend` are kept, `job.stopped` is cleared (and
// recorded in `job.retries`), and the runner resumes AT that step — the stages
// are written to resume (sheets finds its Series by filmId, the run resubmits
// only clips without a live take, stills keeps its per-clip cuts in its own
// result). The failed step gets a fresh retry-once budget; its attempt number
// keeps rising (`attemptBase`) so work that failed before is redone.
//
// Only the project's LATEST Film, only when it is `stopped`, and only when
// nothing is queued. A retry REFUSES rather than queues: the queue holds new
// prompts, and a Film queued ahead of the retry would start first and make the
// stopped one no longer the latest. The kill switch and the allowance are
// checked like a start. A stopped Film never counted, so a retry that finishes
// is its first and only count — countFilm is idempotent on the job id anyway.
//
// Before it resumes, the Film's Series is repaired (`repairFilmSeries` →
// director.js sanitizeSeries) so a value an earlier step wrote outside the
// Series' limits cannot refuse the same write again.

/** The Director Series a Film files onto: from a step's result, else by `filmId`. */
export async function filmSeriesId(env, job) {
  for (const s of job?.steps || []) {
    if (s?.result?.seriesId) return s.result.seriesId;
  }
  const index = await readIndex(env, job.projectId);
  for (const id of index.seriesIds || []) {
    const s = await readSeries(env, job.projectId, id);
    if (s?.filmId === job.id) return s.id;
  }
  return null;
}

/** Sanitize the Film's Series before a retry. → { seriesId, fixes } */
export async function repairFilmSeries(env, job) {
  const seriesId = await filmSeriesId(env, job);
  if (!seriesId) return { seriesId: null, fixes: [] };
  const res = await repairSeries(env, job.projectId, seriesId);
  return { seriesId, fixes: res.fixes || [] };
}

const retryRefusal = (code, message) => ({ ok: false, code, message });

/**
 * Retry a stopped Film from the step that stopped it.
 *
 * state: { job (the project's current — latest — job), queue, archived (the
 *          Film from the history, when `job` is a different one) }
 * deps:  { env, commit, now?, availability?, allowance?, repair?(job) }
 *
 * → { ok: true, job, repaired } | { ok: false, code, message }, code
 *   'not-found' | 'not-latest' | 'busy' | 'not-stopped' | 'paused' |
 *   'unavailable' | 'allowance'.
 */
export async function retryFilm({ job, queue = [], archived = null } = {}, filmId, deps = {}) {
  if (!job || job.id !== filmId) {
    if (!archived) return retryRefusal("not-found", "No such story on this project.");
    return isActive(job)
      ? retryRefusal("busy", "Another story is being made on this project — wait for it to finish.")
      : retryRefusal("not-latest", "A newer story has run on this project since — start a new story instead.");
  }
  if (job.status !== "stopped") {
    return retryRefusal("not-stopped", "Only a story that stopped can be retried.");
  }
  if ((queue || []).length) {
    return retryRefusal("busy", "Another story is waiting to start on this project — wait for it to finish.");
  }
  const at = job.stopped?.stage;
  let i = at ? job.steps.findIndex((s) => s.key === at) : -1;
  if (i < 0) i = job.steps.findIndex((s) => s.status === "failed");
  if (i < 0) return retryRefusal("not-stopped", "This story has no failed step to retry.");

  const avail = await (deps.availability || autoAvailable)(deps.env);
  if (!avail.ok) return retryRefusal(avail.paused ? "paused" : "unavailable", avail.reason);
  if (job.userId) {
    const allowance = await (deps.allowance || checkAllowance)(deps.env, job.userId, deps.now?.());
    if (!allowance.ok) return retryRefusal("allowance", allowance.message);
  }

  let repaired = null;
  if (deps.repair) {
    try {
      repaired = await deps.repair(job);
    } catch (err) {
      // A repair that could not run is no reason to refuse: the step runs, and
      // if the Series still refuses it, it stops again with that reason.
      repaired = { error: String(err?.message || err) };
    }
  }

  const now = iso(deps.now?.());
  const failed = job.steps[i];
  const step = {
    ...failed,
    status: "running",
    pending: false,
    error: null,
    endedAt: null,
    startedAt: now,
    failures: 0,
    attemptBase: (failed.attemptBase || 0) + (failed.failures || 0),
  };
  const { stopped, ...rest } = job;
  const next = {
    ...rest,
    status: "running",
    error: null,
    updatedAt: now,
    // Steps map 1:1 onto FILM_STAGES by position; nothing after the failed one
    // ever started, but drop anything there so the runner resumes HERE.
    steps: [...job.steps.slice(0, i), step],
    retries: [
      ...(job.retries || []),
      { stage: step.key, label: step.label, reason: stopped?.reason ?? failed.error ?? null, at: now, ...(repaired ? { repaired } : {}) },
    ],
  };
  await (deps.commit || (async () => {}))(next, event("film.retried", next, step));
  return { ok: true, job: next, repaired };
}

// ── The Film ────────────────────────────────────────────────────────────────

/**
 * What the finished job hands the surface, from the score stage's result (the
 * SCORED film), the sitting's (its length) and the World's (the title).
 * `null` when there is no scored film — a pipeline whose stages were swapped
 * out (tests) finishes without one.
 */
export function filmOf(job) {
  const done = (key) => job?.steps?.find((s) => s.key === key && s.status === "done")?.result || null;
  // The Director flow's film is the SCORED sitting; the story flow's is its
  // final cut (film-stages/story-flow/stitch.js), which has the same fields.
  const score = done("score") || done("stitch");
  if (!score?.url) return null;
  const sitting = done("sitting");
  const world = done("world");
  const measured = Number(score.measured?.durationMs);
  const seconds = Number.isFinite(measured) && measured > 0
    ? Math.round(measured / 100) / 10
    : Number(sitting?.seconds) || Number(score.seconds) || null;
  return {
    url: score.url,
    file: score.file || null,
    unscored: score.unscored || null,
    seconds,
    seriesId: score.seriesId || sitting?.seriesId || null,
    sittingId: score.sittingId || sitting?.sittingId || null,
    title: str(world?.title) || str(world?.idea) || str(job?.prompt).slice(0, 80) || "Film",
    idea: str(world?.idea) || null,
  };
}

/** "Film — <title>": the name the Film goes by among the project's files. */
export const filmFileName = (film) => `Film — ${film?.title || "Untitled"}`;

/**
 * Register the Film as a project file: stamp the kept sitting it was scored on
 * with `film: { id, title, completedAt }`. `/api/pool` lists every stamped row
 * as a video the Editor (and the agent) can lay on a timeline. A row that is
 * gone is reported, not thrown — the Film is still done.
 */
export async function fileFilm(env, projectId, job, film) {
  if (!film?.sittingId) return { ok: false, missing: true };
  const at = new Date().toISOString();
  const res = await updateSittings(env, projectId, (db) => {
    const row = (db.kept || []).find((s) => s.id === film.sittingId);
    if (!row) return { abort: true, missing: true };
    if (row.film?.id === job.id && row.film?.title === film.title) return { abort: true, same: true };
    row.film = { id: job.id, title: film.title, completedAt: row.film?.completedAt || at };
    return {};
  });
  if (res?.missing) return { ok: false, missing: true };
  return { ok: true };
}

/**
 * The job turns `done`: the Film, the spend total, the project file and the
 * allowance count (kind `new`, once per job id). Neither the filing nor the
 * count may lose a finished Film — a failure is recorded on the job instead.
 *
 * deps: { env, now?, countFilm?, fileFilm?, settleStudio? } (tests pass fakes)
 */
export async function completeFilm(job, deps = {}) {
  const env = deps.env;
  const at = iso(deps.now?.());
  const film = filmOf(job);
  let next = { ...job, status: "done", updatedAt: at, film, spent: totalSpend(job) };

  if (film) {
    try {
      const filed = await (deps.fileFilm || fileFilm)(env, job.projectId, job, film);
      if (filed && filed.ok === false) next.film = { ...film, filed: false };
    } catch (err) {
      next.film = { ...film, filed: false, fileError: String(err?.message || err) };
    }
  }

  // The studio the Film opens into (Continue working on the video): its
  // project's tabs are exactly the steps that ran, and an empty Editor gets
  // the Film on its picture lane (lib/film-plugins.js). Best-effort.
  next.studio = await (deps.settleStudio || settleFilmStudio)(env, next);

  const kind = allowanceKindOf(next);
  try {
    next.allowance = job.userId
      ? await (deps.countFilm || countFilm)(env, job.userId, { filmId: job.id, kind }, deps.now?.())
      : { counted: false, kind };
  } catch (err) {
    next.allowance = { counted: false, kind, error: String(err?.message || err) };
  }
  return next;
}

// ── The confirm card ────────────────────────────────────────────────────────

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * The Film plan the confirm card shows: planFilm on the prompt, with one
 * reference sheet per character and place the World made (at fal's ceiling).
 * → { summary, plan: { seconds, length, capped, reels, pins, sheets, estimate } }
 */
export function confirmPlan(job, worldResult) {
  const scored = filmScoreOf(job?.score);
  if (isStoryEngine(job?.engine)) {
    // Style anchor + a turnaround and a face per character + a plate per place + a sheet per prop.
    const drawn = 1 + 2 * (worldResult?.characters?.length || 0) + (worldResult?.places?.length || 0) + (worldResult?.props?.length || 0);
    const sheets = Math.min(MAX_STORY_FLOW_SHEETS, drawn);
    // The Voices pass auditions every character the World made.
    const characters = worldResult?.characters?.length || 0;
    const input = {
      prompt: job.prompt, seconds: job.seconds ?? null, resolution: job.resolution ?? null, referenceSheets: sheets, score: scored,
      voices: job.voices ?? null, characters, music: job.music ?? "elevenlabs",
    };
    const p = job.engine === "h3" ? planH3(input) : planStoryFlow(input);
    const plan = {
      engine: p.engine, seconds: p.seconds, length: p.length, capped: p.capped, requestedSeconds: p.requestedSeconds,
      segments: p.segments, durations: p.durations, resolution: p.resolution, sheets, voices: p.voices, score: scored, estimate: p.estimate,
    };
    const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
    const at = job.engine === "h3" ? `${p.h3Resolution} on MiniMax H3` : p.resolution;
    const voiced = p.voices ? ` · ${n(characters, "voice")}` : "";
    return { summary: `${p.length} · ${n(p.segments, "segment")} at ${at} · ${n(sheets, "sheet")}${voiced}${scored ? " · scored" : ""} · about ${money(p.estimate.total)}`, plan };
  }
  const drawn = (worldResult?.characters?.length || 0) + (worldResult?.places?.length || 0) + (worldResult?.props?.length || 0);
  const sheets = Math.min(MAX_REFERENCE_SHEETS, Math.max(1, drawn));
  const characters = worldResult?.characters?.length || 0;
  const p = planFilm({
    prompt: job.prompt, seconds: job.seconds ?? null, resolution: job.resolution ?? null, referenceSheets: sheets, score: scored, music: job.music ?? "elevenlabs",
    voices: job.voices ?? null, characters,
  });
  const plan = {
    seconds: p.seconds,
    length: p.length,
    capped: p.capped,
    requestedSeconds: p.requestedSeconds,
    reels: p.reels,
    pins: p.pins,
    sheets,
    voices: p.voices,
    score: scored,
    estimate: p.estimate,
  };
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const voiced = p.voices ? ` · ${n(characters, "voice")}` : "";
  const summary = `${p.length} · ${n(p.reels, "reel")} · ${n(sheets, "sheet")}${voiced}${scored ? "" : " · no score"} · about ${money(p.estimate.total)}`;
  return { summary, plan };
}

/**
 * The author said yes: the job runs on (the DO schedules the next alarm).
 * → `{ ok: true, job }` | `{ ok: false, code: 'not-found'|'not-awaiting' }`
 */
export async function confirmFilm(job, filmId, deps = {}) {
  const gate = answerable(job, filmId);
  if (gate) return gate;
  const at = iso(deps.now?.());
  const next = { ...job, status: "running", updatedAt: at, confirm: { ...job.confirm, status: "confirmed", answeredAt: at } };
  await (deps.commit || (async () => {}))(next, event("film.confirmed", next));
  return { ok: true, job: next };
}

/**
 * The author said no: the job ends `declined`. Nothing after the World runs,
 * nothing more is spent, and it never counts against the allowance.
 */
export async function declineFilm(job, filmId, deps = {}) {
  const gate = answerable(job, filmId);
  if (gate) return gate;
  const at = iso(deps.now?.());
  const next = { ...job, status: "declined", updatedAt: at, confirm: { ...job.confirm, status: "declined", answeredAt: at } };
  await (deps.commit || (async () => {}))(next, event("film.declined", next));
  return { ok: true, job: next };
}

function answerable(job, filmId) {
  if (!job || (filmId && job.id !== filmId)) return { ok: false, code: "not-found" };
  if (job.status !== "awaiting-confirm") return { ok: false, code: "not-awaiting" };
  return null;
}

/** Drive a job until it stops (tests; the DO advances one attempt per alarm). */
export async function runFilm(job, deps) {
  let guard = (deps.stages || stagesFor(job)).length * 2 + 2;
  while (job?.status === "running" && guard-- > 0) job = await advanceFilm(job, deps);
  return job;
}

// The writing model for ONE Film: the author's pick (`job.writer`), else — a job
// from before the writer was explicit — the Worker's AUTO_WRITER (lib/writer.js).
export const filmWriterModel = (env, job) => writerModel(env, job?.writer);
