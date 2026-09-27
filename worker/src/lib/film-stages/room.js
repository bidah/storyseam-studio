// The Film job's "Writers' room" stage — a DEEP Film only (job.depth), right
// after the Script.
//
// The chat improves a script by delegating to fifteen specialists in stage
// order (src/lib/specialists.ts); each reads the pinned draft, hands back
// findings, and the author applies what they accept. A Film has no author in
// the loop, so the room runs by itself: the specialists the author picked on
// the input (`job.specialists`, roster order — the sequence is craft: a
// dialogue pass before the scenes are settled polishes lines about to be cut)
// each read the first draft in ONE model call, carrying their lane and tests
// (./room-notes.js) and their brief; then one REWRITE applies the whole room's
// notes to the draft and saves it as a second draft, pinned, so the Shot list
// is cut from the rewritten script and the first draft stays a version behind
// it.
//
// It is a PENDING stage (film-job.js "Pending stages"), one pass per advance
// and `pollMs: 0` so the next pass follows at once — a room of five is six
// model calls, and one alarm doing all six is one alarm that dies in the
// middle. Its state is the `film-room:<filmId>` doc: which passes are done and
// what each found, so an evicted or retried stage resumes at the next pass
// rather than reading the draft five times over.
//
// Every pass is also RECORDED in the project's `script-reviews` ledger
// (lib/reviews.js) the same way the chat's specialists record theirs, so the
// Script Agents board on the Film's project shows who has read it and what
// they found — the room is not a second, invisible system.
import { DEFAULT_DEEP_SPECIALISTS } from "../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { SPECIALISTS, SPECIALIST_BY_ID } from "../specialists.ts";
import { readDoc, updateDoc } from "../docs.js";
import { cleanNotes, recordReview } from "../reviews.js";
import { readWorld } from "../../routes/world.js";
import { pinnedDraft, readStore } from "../script-store.js";
import { cleanElements, docToElements, formatScreenplay, screenplayStats } from "../script-elements.js";
import { roomNotesFor } from "./room-notes.js";
import { SCREENPLAY_FORMAT, SCREENWRITER_CRAFT, saveScriptDraft, scriptBudget, filmSecondsFor } from "./script.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const ROSTER_INDEX = new Map(SPECIALISTS.map((s, i) => [s.id, i]));

/** The room this job runs, in roster order (the default room when the job names none). */
export function roomOf(job) {
  const ids = Array.isArray(job?.specialists) && job.specialists.length ? job.specialists : DEFAULT_DEEP_SPECIALISTS;
  return [...new Set(ids.filter((id) => SPECIALIST_BY_ID.has(id)))].sort((a, b) => ROSTER_INDEX.get(a) - ROSTER_INDEX.get(b));
}

export const roomDocName = (filmId) => `film-room:${filmId}`;
const EMPTY = { passes: {}, rewrite: null };

function worldBrief(world) {
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

/** One specialist's read of the draft. */
export function passMessages({ specialist, world, elements }) {
  const notes = roomNotesFor(specialist.id);
  const system = [
    `You are ${specialist.label} — one of the fifteen script specialists in StorySeam's writers' room — reading`,
    "the first draft of a short film that will be rendered shot by shot by image and video models. Nobody",
    "will answer a question: decide. You do not rewrite the script; a rewrite follows on the whole room's",
    "notes, so every finding must carry the concrete change that fixes it, quoting the exact line to change",
    "as TYPE: text when a line should change.",
    "",
    `YOUR LANE: ${notes.lane}`,
    ...notes.reads.map((r) => `- ${r}`),
    "",
    `The author's brief: ${specialist.brief}.`,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "summary": string, "findings": [{ "severity": "high" | "medium" | "low", "where": string, "issue": string, "fix": string }] }',
    "`summary` is your one-line verdict. Prefer three to eight findings that matter, most story-breaking",
    "first, over a long list; zero findings is a real answer when the draft passes your lane.",
  ].join("\n");
  const user = [
    ...(notes.worldless ? [] : ["THE WORLD BIBLE:", worldBrief(world), ""]),
    "THE SCREENPLAY:",
    formatScreenplay(elements),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The rewrite: the draft plus the room's notes → the second draft. */
export function rewriteMessages({ world, elements, passes, budget, language = DEFAULT_FILM_LANGUAGE }) {
  const notes = passes
    .map((p) => {
      const s = SPECIALIST_BY_ID.get(p.id);
      const lines = p.notes.map((n) => `  - [${n.severity}] ${n.where ? `${n.where} — ` : ""}${n.issue}${n.fix ? ` → ${n.fix}` : ""}`);
      return [`${s?.label || p.id}: ${p.summary}`, ...(lines.length ? lines : ["  (nothing to fix)"])].join("\n");
    })
    .join("\n\n");
  const system = [
    "You are the screenwriter of StorySeam's Auto pipeline, applying the writers' room's notes to your own",
    "first draft. Apply every fix you agree with, and most of them are right; where two specialists pull",
    "against each other (the punch-up room swings, the dialogue doctor governs), keep the version that keeps",
    "the scene turning and the character legible. Keep what works — this is a revision, not a new script.",
    "",
    `The film still runs EXACTLY ${budget.seconds} seconds: ${budget.scenes} scenes and at most ${budget.dialogueWords} words of`,
    `dialogue in total, in ${language} only. Every character and place keeps its EXACT World name.`,
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
    "THE FIRST DRAFT:",
    formatScreenplay(elements),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The pass answer → { summary, notes } (notes clamped the way the ledger clamps them). */
export function parsePass(answer) {
  const notes = cleanNotes(answer?.findings);
  const summary = str(answer?.summary) || (notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Nothing to fix");
  return { summary, notes };
}

/** The rewrite answer → { title, changes, elements }. Throws when it is not a script. */
export function parseRewrite(answer, fallbackTitle) {
  const elements = cleanElements(answer?.elements);
  if (elements.length < 8) throw new Error(`The rewrite came back with ${elements.length} screenplay lines — not a script.`);
  if (!elements.some((el) => el.type === "scene_heading")) throw new Error("The rewrite has no scene heading.");
  const changes = (Array.isArray(answer?.changes) ? answer.changes : []).map(str).filter(Boolean).slice(0, 12);
  return { title: str(answer?.title) || fallbackTitle, changes, elements };
}

const view = (state, room) => ({
  specialists: room.map((id) => {
    const s = SPECIALIST_BY_ID.get(id);
    const p = state.passes?.[id];
    return { id, chip: s?.chip || id, label: s?.label || id, ...(p ? { summary: p.summary, findings: p.notes.length } : {}) };
  }),
  ...(state.rewrite ? { rewrite: state.rewrite } : {}),
});

/** deps (optional): { readWorld, readStore, saveScriptDraft, recordReview }. */
export async function runRoomStage({ job, results, env, model }, deps = {}) {
  const pid = job.projectId;
  const room = roomOf(job);
  if (!room.length) throw new Error("The writers' room has nobody in it.");
  const doc = roomDocName(job.id);
  const state = { ...EMPTY, ...(await readDoc(env, pid, doc, null)) };

  // The draft the room reads: the Script stage's, as pinned now.
  const store = await (deps.readStore || readStore)(env, pid);
  const draft = pinnedDraft(store);
  const elements = docToElements(draft?.doc);
  if (elements.length < 8) throw new Error("The Film has no screenplay to read — the script step did not finish.");
  const world = await (deps.readWorld || readWorld)(env, pid);
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;

  const next = room.find((id) => !state.passes?.[id]);
  if (next) {
    const specialist = SPECIALIST_BY_ID.get(next);
    const answer = await model.json({ messages: passMessages({ specialist, world, elements }), maxTokens: 8000, temperature: 0.5 });
    const pass = parsePass(answer);
    const at = new Date().toISOString();
    await (deps.recordReview || recordReview)(env, pid, next, {
      at, draftId: draft.id, draftName: draft.name, scriptUpdatedAt: draft.updatedAt,
      summary: pass.summary, findings: pass.notes.length, notes: pass.notes,
    });
    await updateDoc(env, pid, doc, { ...EMPTY }, (d) => {
      d.passes = d.passes || {};
      d.passes[next] = { at, summary: pass.summary, notes: pass.notes };
    });
    state.passes = { ...state.passes, [next]: { at, summary: pass.summary, notes: pass.notes } };
    const done = room.filter((id) => state.passes[id]).length;
    return {
      pending: true,
      pollMs: 0,
      summary: `${done} of ${room.length} · ${specialist.label} read it — ${pass.summary}`,
      result: view(state, room),
    };
  }

  if (!state.rewrite) {
    const passes = room.map((id) => ({ id, ...state.passes[id] }));
    const budget = scriptBudget(filmSecondsFor(job));
    const answer = await model.json({
      messages: rewriteMessages({ world, elements, passes, budget, language: job.language || DEFAULT_FILM_LANGUAGE }),
      maxTokens: 16000,
      temperature: 0.7,
    });
    const rewrite = parseRewrite(answer, draft.title || results?.script?.title || world.title);
    const saved = await (deps.saveScriptDraft || saveScriptDraft)(env, pid, { name: "After the room", title: rewrite.title, elements: rewrite.elements });
    const stats = screenplayStats(rewrite.elements);
    state.rewrite = { ...saved, title: rewrite.title, changes: rewrite.changes, ...stats, at: new Date().toISOString() };
    await updateDoc(env, pid, doc, { ...EMPTY }, (d) => { d.rewrite = state.rewrite; });
  }

  const notes = room.reduce((a, id) => a + (state.passes[id]?.notes?.length || 0), 0);
  return {
    summary: `${n(room.length, "pass")} · ${n(notes, "note")} · rewritten as “${state.rewrite.draftName}” (${n(state.rewrite.scenes, "scene")}, ${n(state.rewrite.lines, "line")})`,
    result: view(state, room),
  };
}
