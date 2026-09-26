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
//   job  = { id, prompt, status: 'running'|'awaiting-confirm'|'done'|'stopped'
//            |'refused'|'declined', error, projectId, episodeId, userId,
//            auto, createdAt, updatedAt, steps: [step],
//            spend: { [stageKey]: dollars }, stopped?: { stage, label, reason,
//            kept: [{ key, label, summary }], spent },
//            confirm?: { status: 'awaiting'|'confirmed'|'declined', after,
//            summary, plan, askedAt, answeredAt } }
//   step = { key, label, status: 'running'|'retrying'|'done'|'failed',
//            startedAt, endedAt, summary, result, error, failures, pending? }
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
// countFilm is NOT called here yet: a Film counts once it is kept (a sitting
// plus a score), which is a later stage — a job that stops after the World has
// not made a Film.
import { groqJSON } from "./groq.js";
import { autoAvailable } from "./auto-availability.js";
import { checkAllowance } from "./film-allowance.js";
import { runWithContext } from "./request-context.js";
import { WORLD_SHAPE } from "./auto-prompts.generated.js";
import { runSheetsStage } from "./film-stages/sheets.js";
import { runShotlistStage } from "./film-stages/shotlist.js";
import { runCueSheetStage } from "./film-stages/cuesheet.js";
import { runRunStage } from "./film-stages/run.js";
import { runStillsStage } from "./film-stages/stills.js";
import { runSittingStage } from "./film-stages/sitting.js";
import { readAutoSettings } from "./auto-settings.js";
import { planFilm, MAX_REFERENCE_SHEETS } from "./film-plan.ts";

export const FILM_EVENT_RESOURCE = "auto";
export const FILM_EVENTS = Object.freeze([
  "film.queued", "film.started", "film.refused", "step.started", "step.retrying",
  "step.done", "step.failed", "film.done", "film.stopped",
  "film.awaiting-confirm", "film.confirmed", "film.declined",
  "step.progress",
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
export async function startFilm(existing, { prompt, userId, projectId, episodeId }, deps = {}) {
  const env = deps.env;
  const text = str(prompt);
  if (!text) return refuse("invalid", "Write a prompt first.");
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
    job = { ...job, status: "done", updatedAt: now() };
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
  const attempt = (step.failures || 0) + 1;
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
    job = { ...job, status: "done", updatedAt: now() };
    await commit(job, event("film.done", job));
  }
  return job;
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
  const p = planFilm({ prompt: job.prompt, referenceSheets: sheets });
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
export const groqModel = (env) => ({ json: (opts) => groqJSON(env, opts) });
