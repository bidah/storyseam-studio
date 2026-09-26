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
//   job  = { id, prompt, status: 'running'|'done'|'failed', error,
//            projectId, episodeId, userId, createdAt, updatedAt, steps: [step] }
//   step = { key, label, status: 'running'|'done'|'failed',
//            startedAt, endedAt, summary, result, error }
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
// sitting → score. A stage is `{ key, label, run(ctx) → { summary, result } }`;
// a throw fails the step and the job.
//
// ── Events ─────────────────────────────────────────────────────────────────
//
// Every transition is committed (persisted, THEN broadcast) through
// `deps.commit(job, event)`. The DO broadcasts it on the project's existing
// live-sync `data` channel as `{ resource: "auto", kind, filmId, step, job }`
// — no new EventSource. Kinds, in the order a job emits them:
//
//   film.started → (step.started → step.done | step.failed)… → film.done | film.failed
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

export const FILM_EVENT_RESOURCE = "auto";
export const FILM_EVENTS = Object.freeze([
  "film.started", "step.started", "step.done", "step.failed", "film.done", "film.failed",
]);
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
  if (existing?.status === "running") {
    return refuse("busy", "A Film is already being made on this project — wait for it to finish.");
  }

  const avail = await (deps.availability || autoAvailable)(env);
  if (!avail.ok) return refuse(avail.paused ? "paused" : "unavailable", avail.reason);

  const allowance = await (deps.allowance || checkAllowance)(env, userId, deps.now?.());
  if (!allowance.ok) return refuse("allowance", allowance.message);

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
      createdAt: at,
      updatedAt: at,
      steps: [],
    },
  };
}

function refuse(code, message) {
  return { ok: false, refusal: { code, message } };
}

const event = (kind, job, step) => ({
  resource: FILM_EVENT_RESOURCE,
  kind,
  filmId: job.id,
  step: step?.key ?? null,
  job: publicJob(job),
});

/**
 * Run the job's NEXT stage to completion and return the new job. A step left
 * `running` (the DO was evicted mid-stage) is run again from its start.
 *
 * deps: { env, model: { json(opts) }, saveWorld, commit(job, event), now? }
 */
export async function advanceFilm(job, deps) {
  if (!job || job.status !== "running") return job;
  const now = () => iso(deps.now?.());
  const commit = deps.commit || (async () => {});

  const last = job.steps[job.steps.length - 1];
  const resuming = last?.status === "running";
  const stage = resuming ? FILM_STAGES.find((s) => s.key === last.key) : FILM_STAGES[job.steps.length];

  if (!stage) {
    job = { ...job, status: "done", updatedAt: now() };
    await commit(job, event("film.done", job));
    return job;
  }

  let step = resuming
    ? last
    : { key: stage.key, label: stage.label, status: "running", startedAt: now(), endedAt: null, summary: null, result: null, error: null };
  job = { ...job, updatedAt: now(), steps: resuming ? job.steps : [...job.steps, step] };
  const replace = (s) => ({ ...job, updatedAt: now(), steps: job.steps.map((x) => (x.key === s.key ? s : x)) });
  if (!resuming) await commit(job, event("step.started", job, step));

  const results = Object.fromEntries(job.steps.filter((s) => s.status === "done").map((s) => [s.key, s.result]));
  try {
    // Doc writes are attributed and episode-scoped from the request context
    // (lib/request-context.js); a job has no request, so it opens its own.
    const out = await runWithContext(
      { userId: job.userId, caller: "auto", chatId: null, episodeId: job.episodeId || undefined },
      () => stage.run({ job, results, env: deps.env, model: deps.model, saveWorld: deps.saveWorld }),
    );
    step = { ...step, status: "done", endedAt: now(), summary: out?.summary ?? null, result: out?.result ?? null };
    job = replace(step);
    await commit(job, event("step.done", job, step));
  } catch (err) {
    const message = String(err?.message || err);
    step = { ...step, status: "failed", endedAt: now(), error: message };
    job = { ...replace(step), status: "failed", error: `${stage.label}: ${message}` };
    await commit(job, event("step.failed", job, step));
    await commit(job, event("film.failed", job));
    return job;
  }

  if (job.steps.length >= FILM_STAGES.length) {
    job = { ...job, status: "done", updatedAt: now() };
    await commit(job, event("film.done", job));
  }
  return job;
}

/** Drive a job until it stops (tests; the DO advances one stage per alarm). */
export async function runFilm(job, deps) {
  let guard = FILM_STAGES.length + 2;
  while (job?.status === "running" && guard-- > 0) job = await advanceFilm(job, deps);
  return job;
}

/** The production model: Groq through AI Gateway (lib/groq.js). */
export const groqModel = (env) => ({ json: (opts) => groqJSON(env, opts) });
