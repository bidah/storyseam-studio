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
//   job  = { id, prompt, seconds?, status: 'running'|'awaiting-confirm'|'done'|'stopped'
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
// `advanceFilm` call. This slice has ONE, `world` ("Idea + World"). The Auto
// pipeline appends, in order: sheets → shotlist → cuesheet → run → stills →
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
// `CONFIRM_AFTER` stage (the World) and before any paid stage runs: status
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
import { autoAvailable } from "./auto-availability.js";
import { checkAllowance, countFilm } from "./film-allowance.js";
import { readIndex, readSeries, repairSeries, updateSittings } from "./director.js";
import { runWithContext } from "./request-context.js";
import { WORLD_SHAPE } from "./auto-prompts.generated.js";
import { runSheetsStage } from "./film-stages/sheets.js";
import { runShotlistStage } from "./film-stages/shotlist.js";
import { runCueSheetStage } from "./film-stages/cuesheet.js";
import { runRunStage } from "./film-stages/run.js";
import { runStillsStage } from "./film-stages/stills.js";
import { runSittingStage } from "./film-stages/sitting.js";
import { runScoreStage } from "./film-stages/score.js";
import { readAutoSettings } from "./auto-settings.js";
import { planFilm, formatLength, FILM_STEPS, MAX_REFERENCE_SHEETS } from "./film-plan.ts";

/**
 * A Film length someone CHOSE (the /director-story gear, make_film's `seconds`)
 * → null when it is fine, else why not. Absent is fine — the prompt, or the
 * 2:00 default, decides — but a value that is not exactly one of the 30s steps
 * is refused, not rounded: a control sent it, and rounding would hide the bug.
 */
export function checkFilmSeconds(seconds) {
  if (seconds === undefined || seconds === null) return null;
  if (typeof seconds === "number" && FILM_STEPS.includes(seconds)) return null;
  return `A Film is ${FILM_STEPS.map(formatLength).join(", ")} long — choose one of those.`;
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
export const nextAlarmDelay = (job) => (job?.steps?.at(-1)?.pending ? PENDING_POLL_MS : 0);

/** The stage after which an Auto-off job pauses to ask. */
export const CONFIRM_AFTER = "world";

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
export function worldMessages(prompt) {
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
    "Ignore sheetImage and voiceRef — they are attached later by other steps.",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "idea": string, "world": { "title": string, "logline": string,',
    '  "map": { "world", "protagonist", "antagonist", "stakes", "theme" },',
    '  "depth": { "premise", "wantVsNeed", "conflict", "obstacles", "structure" },',
    '  "characters": [{ "name", "archetype", "role", "want", "need", "traits", "arc", "voice", "appearance" }],',
    '  "locations": [{ "name", "description" }] } }',
    "Every value is a string except the two arrays.",
  ].join("\n");
  return [
    { role: "system", content: system },
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
    },
  };
}

async function runWorldStage({ job, model, env, saveWorld }) {
  const answer = await model.json({ messages: worldMessages(job.prompt), maxTokens: 8000, temperature: 0.8 });
  const { idea, world } = parseIdeaWorld(answer);
  await saveWorld(env, job.projectId, { ...world, source: "auto" });
  const characters = world.characters.map((c) => ({ name: c.name, role: c.role || c.archetype || "" }));
  const places = world.locations.map((l) => ({ name: l.name, description: l.description || "" }));
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return {
    summary: `${world.title || "World"} — ${n(characters.length, "character")}, ${n(places.length, "place")}`,
    result: { idea, title: world.title, logline: world.logline, characters, places },
  };
}

/** The ordered stages. Later slices append; keys are stable public ids. */
export const FILM_STAGES = Object.freeze([
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
export async function startFilm(existing, { prompt, seconds, userId, projectId, episodeId }, deps = {}) {
  const env = deps.env;
  const text = str(prompt);
  if (!text) return refuse("invalid", "Write a prompt first.");
  const badLength = checkFilmSeconds(seconds);
  if (badLength) return refuse("invalid", badLength);
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
  const stages = deps.stages || FILM_STAGES;
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
      step = { ...step, status: "running", pending: true, summary: out.summary ?? step.summary, result: out.result ?? step.result };
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
    return job;
  }

  // Auto off: ask once, after the World, before anything is paid for.
  if (stage.key === CONFIRM_AFTER && job.auto === false && !job.confirm) {
    const confirm = { status: "awaiting", after: stage.key, ...confirmPlan(job, step.result), askedAt: now(), answeredAt: null };
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
  const score = done("score");
  if (!score?.url) return null;
  const sitting = done("sitting");
  const world = done("world");
  const measured = Number(score.measured?.durationMs);
  const seconds = Number.isFinite(measured) && measured > 0
    ? Math.round(measured / 100) / 10
    : Number(sitting?.seconds) || null;
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
 * deps: { env, now?, countFilm?, fileFilm? } (tests pass fakes)
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
  const drawn = (worldResult?.characters?.length || 0) + (worldResult?.places?.length || 0);
  const sheets = Math.min(MAX_REFERENCE_SHEETS, Math.max(1, drawn));
  const p = planFilm({ prompt: job.prompt, seconds: job.seconds ?? null, referenceSheets: sheets });
  const plan = {
    seconds: p.seconds,
    length: p.length,
    capped: p.capped,
    requestedSeconds: p.requestedSeconds,
    reels: p.reels,
    pins: p.pins,
    sheets,
    estimate: p.estimate,
  };
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const summary = `${p.length} · ${n(p.reels, "reel")} · ${n(sheets, "sheet")} · about ${money(p.estimate.total)}`;
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
  let guard = (deps.stages || FILM_STAGES).length * 2 + 2;
  while (job?.status === "running" && guard-- > 0) job = await advanceFilm(job, deps);
  return job;
}

/** The production model: Groq through AI Gateway (lib/groq.js). */
// The writing model — Workers AI Kimi by default, Groq behind AUTO_WRITER=groq (lib/writer.js).
export const groqModel = (env) => writerModel(env);
