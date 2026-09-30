// The Film job's "Writers' room" stage — a DEEP Film only (job.depth), right
// after the Script.
//
// The room is the chat's own specialists, run for real: each pass is a flue
// agent instance carrying that specialist's full subagent profile and its read
// tools (flue-agent/src/agents/writers-room.ts), on the writer the author
// picked for the Film in the prompt box (`job.writer` — Qwen, Kimi or Claude),
// like every other writing step; the round's rewrite too. The sequence is a flue-side Cloudflare
// Workflow (flue-agent/src/cloudflare.ts `WritersRoomWorkflow`), so every pass
// and every rewrite is a checkpointed step that survives a deploy of either
// worker, which an alarm-driven stage here never did.
//
// It used to be one JSON call per specialist against a three-line summary of
// its profile (room-notes.js), on the Film's default writer, and one rewrite at
// the end: a room of four read and rewrote a script in about five seconds.
//
// The room runs in ROUNDS, by the roster's stage (src/lib/specialists.ts
// STAGE_ORDER — outline → draft → polish → lock): the specialists of one round
// read the current pinned draft side by side, then the screenwriter applies
// that round's notes as a new pinned draft, and the next round reads THAT. A
// dialogue pass therefore reads the scenes the scene doctor already fixed,
// which is the whole reason the roster has an order.
//
// Who does what:
//   - this stage starts the workflow (POST /rooms/:filmId on the flue worker)
//     and then only polls the `film-room:<filmId>` doc, which is the room's
//     single source of truth for the Film page and the Script Agents board;
//   - the workflow reports each pass (POST /api/auto/films/:id/room/pass →
//     recordRoomPass) and asks for each round's rewrite
//     (POST …/room/rewrite → rewriteRound), which stays HERE because the
//     budget, the takes and the author's locked lines are worker code;
//   - it ends with POST …/room/finish.
import { DEFAULT_DEEP_SPECIALISTS } from "../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { SPECIALISTS, SPECIALIST_BY_ID, STAGE_ORDER } from "../specialists.ts";
import { readDoc, updateDoc } from "../docs.js";
import { cleanNotes, recordReview } from "../reviews.js";
import { readWorld } from "../../routes/world.js";
import { pinnedDraft, readStore } from "../script-store.js";
import { cleanElements, docToElements, formatScreenplay, screenplayStats } from "../script-elements.js";
import { SCREENPLAY_FORMAT, SCREENWRITER_CRAFT, saveScriptDraft, filmBudgetFor, takesBrief } from "./script.js";
import { authorLines, authorLinesBrief, restoreLines } from "./author-lines.js";
import { agentWriterModel, writerModel } from "../writer.js";
import { flueFetch } from "../flue-workflow.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const ROSTER_INDEX = new Map(SPECIALISTS.map((s, i) => [s.id, i]));

/** How long between two looks at the room's progress. */
export const ROOM_POLL_MS = 20_000;
/** A report longer than this is cut before it reaches the rewrite prompt. */
const REPORT_CAP = 12_000;

/** The room this job runs, in roster order (the default room when the job names none). */
export function roomOf(job) {
  const ids = Array.isArray(job?.specialists) && job.specialists.length ? job.specialists : DEFAULT_DEEP_SPECIALISTS;
  return [...new Set(ids.filter((id) => SPECIALIST_BY_ID.has(id)))].sort((a, b) => ROSTER_INDEX.get(a) - ROSTER_INDEX.get(b));
}

/** The room in rounds: one per roster stage that has anyone in it. → [{ round, stage, specialists }] */
export function roomRounds(room) {
  const rounds = [];
  for (const stage of STAGE_ORDER) {
    const specialists = room.filter((id) => SPECIALIST_BY_ID.get(id)?.stage === stage);
    if (specialists.length) rounds.push({ round: rounds.length + 1, stage, specialists });
  }
  return rounds;
}

export const roomDocName = (filmId) => `film-room:${filmId}`;
const EMPTY = { v: 2, passes: {}, rewrites: {}, rewrite: null };

// ── What each pass is told ───────────────────────────────────────────────────

/**
 * The Film's constraints, handed to every pass in its message: the specialists'
 * profiles were written for the chat's series, and a Film is a short piece
 * with a fixed length and nobody to ask.
 */
export function roomBrief(job) {
  const budget = filmBudgetFor(job);
  const locked = authorLines(job.prompt);
  return [
    `The film runs EXACTLY ${budget.seconds} seconds: ${budget.scenes} scenes and at most ${budget.dialogueWords} words of dialogue in total, in ${job.language || DEFAULT_FILM_LANGUAGE}.`,
    ...(budget.takes ? takesBrief(budget) : []),
    ...(locked.length ? ["", ...authorLinesBrief(locked), "Write NO note that changes, cuts or replaces one of them — note around them instead."] : []),
  ].join("\n");
}

// ── The rewrite (one per round) ──────────────────────────────────────────────

export function worldBrief(world) {
  const cast = (world.characters || [])
    .map((c) => {
      const bits = [c.role, c.want && `wants ${c.want}`, c.traits, c.voice && `voice: ${c.voice}`].map(str).filter(Boolean);
      return `- ${c.name}${bits.length ? ` — ${bits.join("; ")}` : ""}`;
    })
    .join("\n");
  const places = (world.locations || []).map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`).join("\n");
  return [
    `Title: ${world.title || "(untitled)"}`,
    world.logline ? `Logline: ${world.logline}` : "",
    world.map?.theme ? `Theme: ${world.map.theme}` : "",
    world.map?.stakes ? `Stakes: ${world.map.stakes}` : "",
    "",
    "Characters:",
    cast || "(none)",
    "",
    "Places:",
    places || "(none)",
  ].filter((l) => l !== "").join("\n");
}

/** The rewrite: the current draft plus one round's reports → the next draft. */
export function rewriteMessages({ world, elements, passes, budget, stage, language = DEFAULT_FILM_LANGUAGE, locked = [] }) {
  const notes = passes
    .map((p) => {
      const s = SPECIALIST_BY_ID.get(p.id);
      const head = `### ${s?.label || p.id} — ${p.summary}`;
      const body = str(p.report).slice(0, REPORT_CAP)
        || p.notes.map((n) => `- [${n.severity}] ${n.where ? `${n.where} — ` : ""}${n.issue}${n.fix ? ` → ${n.fix}` : ""}`).join("\n")
        || "(nothing to fix)";
      return `${head}\n${body}`;
    })
    .join("\n\n");
  const system = [
    "You are the screenwriter of StorySeam's Auto pipeline, applying one round of the writers' room's notes to",
    `your own draft — the ${stage} round. Apply every fix you agree with, and most of them are right: a note that`,
    "asks for a new beat, a turned scene, a cause planted earlier or a line cut means CHANGING THE SCRIPT that",
    "much, not rewording the line it pointed at. Where two specialists pull against each other, keep the version",
    "that keeps the scene turning and the character legible. Keep what already works — this is a revision.",
    "",
    `The film still runs EXACTLY ${budget.seconds} seconds: ${budget.scenes} scenes and at most ${budget.dialogueWords} words of`,
    `dialogue in total, in ${language} only. Every character and place keeps its EXACT World name.`,
    ...(budget.takes ? ["", ...takesBrief(budget)] : []),
    ...(locked.length
      ? ["", ...authorLinesBrief(locked), "A note that asks to change one of them is overruled: the line stays exactly as it is."]
      : []),
    "",
    SCREENWRITER_CRAFT,
    "",
    SCREENPLAY_FORMAT,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "title": string, "changes": [string], "elements": [{ "type": string, "text": string }] }',
    "`changes` is one line per change you made (at most twelve); `elements` is the WHOLE revised screenplay.",
  ].join("\n");
  const user = [
    "THE WORLD BIBLE:",
    worldBrief(world),
    "",
    "THE ROOM'S NOTES:",
    notes,
    "",
    "THE CURRENT DRAFT:",
    formatScreenplay(elements),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The rewrite answer → { title, changes, elements }. Throws when it is not a script. */
export function parseRewrite(answer, fallbackTitle) {
  const elements = cleanElements(answer?.elements);
  if (elements.length < 8) throw new Error(`The rewrite came back with ${elements.length} screenplay lines — not a script.`);
  if (!elements.some((el) => el.type === "scene_heading")) throw new Error("The rewrite has no scene heading.");
  const changes = (Array.isArray(answer?.changes) ? answer.changes : []).map(str).filter(Boolean).slice(0, 12);
  return { title: str(answer?.title) || fallbackTitle, changes, elements };
}

/** One specialist's report, from the workflow → the room doc and the Script Agents ledger. */
export async function recordRoomPass(env, pid, filmId, { round, specialist, summary, findings, report, skipped, error }, deps = {}) {
  if (!SPECIALIST_BY_ID.has(specialist)) throw Object.assign(new Error(`Unknown specialist: ${specialist}`), { status: 400 });
  // A pass that used up its attempts (flue's retry budget, WritersRoom
  // durability) is filed as SKIPPED and the room goes on without it: one
  // specialist that could not read the draft is no reason to stop a Film. It
  // has no report, so the rewrite never sees it, and a Film retried later
  // reads it again (the workflow only skips passes that have a report).
  if (skipped) {
    const why = str(error).slice(0, 300) || "The pass did not finish.";
    const pass = { at: new Date().toISOString(), round: Number(round) || 1, skipped: true, error: why, summary: `Skipped — ${why}`, notes: [] };
    await updateDoc(env, pid, roomDocName(filmId), { ...EMPTY }, (d) => {
      d.passes = d.passes || {};
      if (typeof d.passes[specialist]?.report !== "string") d.passes[specialist] = pass;
    });
    return pass;
  }
  const notes = cleanNotes(findings);
  const text = str(report).slice(0, REPORT_CAP * 2);
  const sum = str(summary).slice(0, 400) || (notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Nothing to fix");
  const at = new Date().toISOString();
  const store = await (deps.readStore || readStore)(env, pid);
  const draft = pinnedDraft(store);
  await (deps.recordReview || recordReview)(env, pid, specialist, {
    at, draftId: draft?.id, draftName: draft?.name, scriptUpdatedAt: draft?.updatedAt,
    summary: sum, findings: notes.length, notes,
  });
  const pass = { at, round: Number(round) || 1, summary: sum, notes, report: text, draftId: draft?.id || null };
  await updateDoc(env, pid, roomDocName(filmId), { ...EMPTY }, (d) => {
    d.passes = d.passes || {};
    d.passes[specialist] = pass;
  });
  return pass;
}

/**
 * Apply round `round`'s reports to the pinned draft and pin the result.
 * Idempotent: a round already rewritten answers with what it saved.
 * deps (optional): { model, readWorld, readStore, saveScriptDraft }.
 */
export async function rewriteRound(env, job, round, deps = {}) {
  const pid = job.projectId;
  const name = roomDocName(job.id);
  const state = { ...EMPTY, ...(await readDoc(env, pid, name, null)) };
  const key = String(round);
  if (state.rewrites?.[key]) return state.rewrites[key];
  // The room's stage already closed on the draft it reported, and the Shot list
  // cuts from THAT one (story-flow/shotlist.js storyDraft). A second workflow
  // instance still rewriting pinned a "polish" draft two minutes after
  // film-a45e1cb9's Shot list ran, so the Script tab showed words the film
  // never said. Answer without pinning anything.
  if (job.steps?.find((s) => s?.key === "room")?.status === "done") {
    console.warn("film room: a rewrite after the room closed; not pinned", job.id, round);
    return { round: Number(round), late: true, kept: true, changes: [] };
  }

  const rounds = roomRounds(roomOf(job));
  const spec = rounds.find((r) => r.round === Number(round));
  if (!spec) throw Object.assign(new Error(`The room has no round ${round}.`), { status: 400 });
  const passes = spec.specialists.filter((id) => typeof state.passes?.[id]?.report === "string").map((id) => ({ id, ...state.passes[id] }));
  if (!passes.length) throw Object.assign(new Error(`Nobody in round ${round} has reported yet.`), { status: 409 });

  const store = await (deps.readStore || readStore)(env, pid);
  const draft = pinnedDraft(store);
  const elements = docToElements(draft?.doc);
  if (elements.length < 8) throw new Error("The Film has no screenplay to rewrite — the script step did not finish.");
  const world = await (deps.readWorld || readWorld)(env, pid);
  const locked = authorLines(job.prompt);
  const budget = filmBudgetFor(job);
  const model = deps.model || writerModel(env, job.writer);

  const started = Date.now();
  const answer = await model.json({
    messages: rewriteMessages({ world, elements, passes, budget, stage: spec.stage, language: job.language || DEFAULT_FILM_LANGUAGE, locked }),
    maxTokens: 16000,
  });
  const rewrite = parseRewrite(answer, draft.title || world.title);
  // The author's lines, checked in code: a rewrite that dropped one gets it
  // back where it was; one with no clear place for it is not used at all —
  // the draft it read stays pinned, since it still has the author's words.
  const kept = restoreLines(locked, elements, rewrite.elements);
  const at = new Date().toISOString();
  let entry;
  if (kept) {
    const changes = [...kept.restored.map((l) => `Kept the author's line “${l}” as written.`), ...rewrite.changes].slice(0, 12);
    const saved = await (deps.saveScriptDraft || saveScriptDraft)(env, pid, {
      name: `After the room · ${spec.stage}`, title: rewrite.title, elements: kept.elements,
    });
    entry = { round: spec.round, stage: spec.stage, ...saved, title: rewrite.title, changes, ...screenplayStats(kept.elements), ms: Date.now() - started, at };
  } else {
    console.warn("film room: the rewrite dropped the author's line(s); keeping the draft", job.id, round);
    entry = {
      round: spec.round, stage: spec.stage, draftId: draft.id, draftName: draft.name, updatedAt: draft.updatedAt, title: draft.title || rewrite.title,
      changes: ["The rewrite changed the author's own lines, so the draft it read was kept."], kept: true,
      ...screenplayStats(elements), ms: Date.now() - started, at,
    };
  }
  await updateDoc(env, pid, name, { ...EMPTY }, (d) => {
    d.rewrites = d.rewrites || {};
    d.rewrites[key] = entry;
    d.rewrite = entry;
  });
  return entry;
}

/** The workflow's last word: `done`, or `failed` with the reason. */
export async function finishRoom(env, pid, filmId, { status, error }) {
  const ok = status === "done";
  await updateDoc(env, pid, roomDocName(filmId), { ...EMPTY }, (d) => {
    d.status = ok ? "done" : "failed";
    d.error = ok ? null : str(error).slice(0, 600) || "The writers' room stopped.";
    d.endedAt = new Date().toISOString();
  });
  return { ok: true };
}

// ── Talking to the flue worker ───────────────────────────────────────────────

/** Start (or re-attach to) the room's workflow. → { instanceId, status } */
export function startRoomWorkflow(env, job, { instanceId, rounds }) {
  return flueFetch(env, `/rooms/${encodeURIComponent(instanceId)}`, {
    userId: job.userId,
    what: "The writers' room",
    method: "POST",
    body: {
      filmId: job.id,
      projectId: job.projectId,
      userId: job.userId,
      episodeId: job.episodeId || null,
      rounds,
      brief: roomBrief(job),
      // The passes read on the Film's own writer, as a flue specifier.
      model: agentWriterModel(env, job.writer),
    },
  });
}

/** The workflow instance's status as Cloudflare reports it. → { status, error? } */
export function roomWorkflowStatus(env, job, instanceId) {
  return flueFetch(env, `/rooms/${encodeURIComponent(instanceId)}`, { userId: job.userId, what: "The writers' room" });
}

// ── The stage ────────────────────────────────────────────────────────────────

const view = (state, room, rounds) => ({
  specialists: room.map((id) => {
    const s = SPECIALIST_BY_ID.get(id);
    const p = state.passes?.[id];
    const r = rounds.find((x) => x.specialists.includes(id));
    return {
      id, chip: s?.chip || id, label: s?.label || id, round: r?.round || null,
      ...(p?.report !== undefined ? { summary: p.summary, findings: p.notes.length } : {}),
      ...(p?.skipped ? { summary: p.summary, skipped: true } : {}),
    };
  }),
  rounds: rounds.map((r) => ({ ...r, ...(state.rewrites?.[String(r.round)] ? { rewrite: state.rewrites[String(r.round)] } : {}) })),
  ...(state.rewrite ? { rewrite: state.rewrite } : {}),
});

const plural = (k, one) => `${k} ${one}${k === 1 ? "" : one.endsWith("s") ? "es" : "s"}`;

/**
 * The Film card's line while the room works. It says how long the current
 * step has been going (since the room's last event: its start, a pass, a
 * rewrite), because "story_architect reading" for fifty minutes with no clock
 * reads as a Film that is stuck on its first draft.
 */
export function progress(state, room, rounds, now = Date.now()) {
  const done = room.filter((id) => state.passes?.[id]?.report !== undefined);
  const skipped = room.filter((id) => state.passes?.[id]?.skipped);
  const settled = [...done, ...skipped];
  const current = rounds.find((r) => !state.rewrites?.[String(r.round)] && !r.specialists.every((id) => skipped.includes(id)));
  const events = [state.startedAt, ...Object.values(state.passes || {}).map((p) => p?.at), ...Object.values(state.rewrites || {}).map((w) => w?.at)]
    .map((t) => Date.parse(t || "")).filter(Number.isFinite);
  const mins = events.length ? Math.floor((now - Math.max(...events)) / 60_000) : 0;
  const clock = mins >= 1 ? ` · ${mins} min` : "";
  const tail = skipped.length ? ` · ${plural(skipped.length, "pass")} skipped` : "";
  if (!current) return `${plural(done.length, "pass")} read${tail} · final rewrite saving${clock}`;
  const waiting = current.specialists.filter((id) => !settled.includes(id));
  const who = (ids) => ids.map((id) => SPECIALIST_BY_ID.get(id)?.label || id).join(", ");
  const head = `Round ${current.round} of ${rounds.length} (${current.stage})`;
  return waiting.length
    ? `${head} · ${who(waiting)} reading${clock} · ${done.length} of ${room.length} passes in${tail}`
    : `${head} · the screenwriter is applying ${who(current.specialists.filter((id) => done.includes(id)))}'s notes${clock}${tail}`;
}

/** deps (optional): { startRoom, roomStatus, now } — tests pass fakes. */
export async function runRoomStage({ job, env, attempt = 1 }, deps = {}) {
  const pid = job.projectId;
  const room = roomOf(job);
  if (!room.length) throw new Error("The writers' room has nobody in it.");
  const rounds = roomRounds(room);
  const name = roomDocName(job.id);
  let state = { ...EMPTY, ...(await readDoc(env, pid, name, null)) };

  // A room from before the workflow (v1: one JSON pass per specialist) that
  // already finished is honoured as it is; one that did not is run again.
  if (!state.v && state.rewrite) {
    return { summary: `${plural(room.length, "pass")} · rewritten as “${state.rewrite.draftName}”`, result: view(state, room, rounds) };
  }

  if (state.status === "done") {
    const notes = room.reduce((a, id) => a + (state.passes?.[id]?.notes?.length || 0), 0);
    const last = state.rewrite;
    const read = room.filter((id) => typeof state.passes?.[id]?.report === "string").length;
    const skipped = room.length - read;
    const passes = `${plural(read, "pass")}${skipped ? ` (${skipped} skipped)` : ""}`;
    return {
      summary: last?.kept
        ? `${passes} in ${plural(rounds.length, "round")} · ${plural(notes, "note")} · kept “${last.draftName}” — a rewrite changed the author's own lines`
        : `${passes} in ${plural(rounds.length, "round")} · ${plural(notes, "note")} · rewritten as “${last?.draftName || "the room's draft"}”`,
      result: view(state, room, rounds),
    };
  }

  // A workflow that failed — or a Film retried after one — gets a fresh
  // instance; the new run skips the passes and rewrites already on file.
  const failed = state.status === "failed";
  const instanceFor = (n) => `room-${job.id}-${n}`;
  const needStart = !state.instanceId || (failed && state.startedAttempt !== attempt);
  if (failed && !needStart) throw new Error(state.error || "The writers' room stopped.");

  if (needStart) {
    const n = (state.starts || 0) + 1;
    const instanceId = instanceFor(n);
    await (deps.startRoom || startRoomWorkflow)(env, job, { instanceId, rounds });
    const at = new Date().toISOString();
    await updateDoc(env, pid, name, { ...EMPTY }, (d) => {
      Object.assign(d, { v: 2, instanceId, starts: n, startedAttempt: attempt, status: "running", error: null, startedAt: d.startedAt || at, rounds });
    });
    state = { ...state, instanceId, starts: n, startedAttempt: attempt, status: "running" };
    return { pending: true, pollMs: ROOM_POLL_MS, summary: `The room is in: ${room.map((id) => SPECIALIST_BY_ID.get(id)?.label || id).join(", ")}`, result: view(state, room, rounds) };
  }

  // Still running. Ask Cloudflare too, so a workflow that died without
  // reporting (its finish step never ran) does not leave the Film waiting.
  try {
    const wf = await (deps.roomStatus || roomWorkflowStatus)(env, job, state.instanceId);
    if (wf?.status === "errored" || wf?.status === "terminated") {
      const reason = wf.error?.message || wf.error || `the workflow ${wf.status}`;
      await finishRoom(env, pid, job.id, { status: "failed", error: String(reason) });
      throw new Error(`The writers' room stopped: ${reason}`);
    }
  } catch (err) {
    if (String(err?.message || "").startsWith("The writers' room stopped")) throw err;
    console.warn("film room: status check failed", job.id, String(err?.message || err));
  }
  return { pending: true, pollMs: ROOM_POLL_MS, summary: progress(state, room, rounds), result: view(state, room, rounds) };
}
