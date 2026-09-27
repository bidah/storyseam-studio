// The Film job's "Script" stage, as a flow of passes rather than one call.
//
// It used to be ONE model call on the Film's writer: on the fast default
// (Qwen on Cerebras, no reasoning) the screenplay came back in about a second,
// and it read like it — film-5c2d3453, a two-minute film, got two scenes and
// twenty words of dialogue, and nothing checked it against the budget before
// the Shot list cut it (or before a Deep Film's room spent its first round
// rebuilding it). Now every Film writes its script in passes, each on the
// writer the author picked for the Film (`job.writer` — the studio's default
// or Claude; lib/writer.js), never a different one:
//
//   1. outline — the arc, the beats, and a plan per scene: its place, who
//      drives it, the value it opens and closes on, the turn, the plants and
//      payoffs, and the words of dialogue it may spend. Stored, not shown.
//   2. draft   — the screenplay written FROM the outline → "First draft".
//   3. revise  — the writer reviews its own draft the way the room would
//      (the craft, scene by scene) AND against what code measured (scene
//      count, one scene per take, dialogue against the budget, World names,
//      the author's quoted lines), then rewrites → "Revised draft".
//   4. revise again — only when a measured problem survived the first one
//      (a take with no scene, dialogue far under or over): → "Revised draft · 2".
//
// The sequence is the flue worker's FilmScriptWorkflow
// (flue-agent/src/cloudflare.ts), for the same reason the room is one: each
// pass is a checkpointed step, so a deploy mid-pass retries that pass instead
// of stranding the Film. The workflow calls back here for every pass
// (POST /api/auto/films/:id/script/pass → runScriptPass) because the budget,
// the World and the author's lines are worker code; the stage below only
// starts it and polls the `film-script:<filmId>` doc.
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { readDoc, updateDoc } from "../docs.js";
import { readWorld } from "../../routes/world.js";
import { pinnedDraft, readStore } from "../script-store.js";
import { docToElements, formatScreenplay, screenplayStats, WORDS_PER_SECOND } from "../script-elements.js";
import { writerModel } from "../writer.js";
import { flueFetch } from "../flue-workflow.js";
import { formatLength } from "../film-plan.ts";
import {
  SCREENPLAY_FORMAT, SCREENWRITER_CRAFT, filmBudgetFor, parseScript, saveScriptDraft, scriptMessages, takesBrief,
} from "./script.js";
import { authorLines, authorLinesBrief, missingLines, restoreLines } from "./author-lines.js";
import { parseRewrite, worldBrief } from "./room.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const words = (t) => str(t).split(/\s+/).filter(Boolean).length;
const norm = (t) => str(t).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/** The passes, in order. `revise-2` runs only when `revise-1` says a measured problem survived. */
export const SCRIPT_PASSES = Object.freeze(["outline", "draft", "revise-1", "revise-2"]);
/** How long between two looks at the flow's progress — a fast writer finishes a pass in seconds. */
export const SCRIPT_POLL_MS = 6_000;
export const scriptDocName = (filmId) => `film-script:${filmId}`;
const EMPTY = { v: 1, passes: {} };

/** The writer for this Film's script: the one the author picked, whatever it is. */
export const scriptWriterFor = (env, job) => writerModel(env, job?.writer);

// ── What code measures ───────────────────────────────────────────────────────

/** Dialogue below this share of the budget reads as a silent film; above the ceiling, it is cut. */
const DIALOGUE_FLOOR = 0.6;
const DIALOGUE_CEILING = 1.1;

/**
 * What is wrong with a screenplay that code can see. → [{ hard, issue }]
 * `hard` problems break the Film downstream (a take with no scene, a line the
 * author asked for missing, dialogue far off the budget) and earn a second
 * revision; the rest are handed to the writer as notes.
 */
export function scriptIssues(elements, { budget, world, locked = [] }) {
  const issues = [];
  const stats = screenplayStats(elements);
  const takes = budget.takes;
  if (takes) {
    if (stats.scenes !== takes.length) {
      issues.push({ hard: true, issue: `The film is ${takes.length} takes and a scene IS a take, but the draft has ${stats.scenes} scenes. Write exactly ${takes.length}, one per take, in order.` });
    }
  } else if (stats.scenes < Math.max(2, budget.scenes - 1) || stats.scenes > budget.scenes + 1) {
    issues.push({ hard: stats.scenes < 2, issue: `The draft has ${stats.scenes} scenes; a film of ${formatLength(budget.seconds)} holds about ${budget.scenes}.` });
  }
  const floor = Math.round(budget.dialogueWords * DIALOGUE_FLOOR);
  const ceiling = Math.round(budget.dialogueWords * DIALOGUE_CEILING);
  if (stats.dialogueWords < floor) {
    issues.push({
      hard: stats.dialogueWords < Math.round(budget.dialogueWords * 0.4),
      issue: `Only ${stats.dialogueWords} words of dialogue against a budget of ${budget.dialogueWords} (about ${stats.spokenSeconds}s spoken in a ${budget.seconds}s film): the film will play thin. Give the scenes the exchanges they need — aim for ${Math.round(budget.dialogueWords * 0.8)}–${budget.dialogueWords} words — without narrating.`,
    });
  } else if (stats.dialogueWords > ceiling) {
    issues.push({ hard: true, issue: `${stats.dialogueWords} words of dialogue against a budget of ${budget.dialogueWords}: it plays at ${WORDS_PER_SECOND} words a second and the film would be cut short. Cut to the budget.` });
  }
  if (takes) {
    // Per take: a scene that spends far more than its take can say is cut mid-line.
    let scene = -1;
    const perScene = [];
    for (const el of elements) {
      if (el.type === "scene_heading") perScene[++scene] = 0;
      else if (el.type === "dialogue" && scene >= 0) perScene[scene] += words(el.text);
    }
    perScene.forEach((w, i) => {
      const d = takes[i];
      if (!d) return;
      const cap = Math.round(d * (2 / 3) * WORDS_PER_SECOND * 1.25);
      if (w > cap) issues.push({ hard: false, issue: `Scene ${i + 1} has ${w} words of dialogue for a ${d}s take (about ${Math.round(d * (2 / 3) * WORDS_PER_SECOND)} fit). Trim it.` });
    });
  }
  const cast = new Map((world.characters || []).map((c) => [norm(c.name), c.name]));
  const strangers = [...new Set(elements.filter((el) => el.type === "character").map((el) => str(el.text).replace(/\s*\(.*\)\s*$/, "")))]
    .filter((n) => n && !cast.has(norm(n)));
  if (cast.size && strangers.length) {
    issues.push({ hard: false, issue: `Speakers not in the World's cast: ${strangers.join(", ")}. Every cue is one of: ${[...cast.values()].join(", ")}.` });
  }
  const places = (world.locations || []).map((l) => norm(l.name)).filter(Boolean);
  if (places.length) {
    const unplaced = elements
      .filter((el) => el.type === "scene_heading")
      .map((el) => el.text)
      .filter((h) => !places.some((p) => norm(h).includes(p)));
    if (unplaced.length) {
      issues.push({ hard: false, issue: `Scene headings that name no World place: ${unplaced.map((h) => `“${h}”`).join(", ")}. Use the place names exactly: ${(world.locations || []).map((l) => l.name).join(", ")}.` });
    }
  }
  const dropped = missingLines(locked, elements);
  if (dropped.length) issues.push({ hard: true, issue: `The author's own line(s) are missing: ${dropped.map((l) => `“${l}”`).join(", ")}. They are said word for word.` });
  return issues;
}

// ── Pass 1: the outline ──────────────────────────────────────────────────────

export function outlineMessages({ idea, world, budget, language = DEFAULT_FILM_LANGUAGE, locked = [] }) {
  const [, user] = scriptMessages({ idea, world, budget, language, locked });
  const system = [
    "You are the screenwriter of StorySeam's Auto pipeline, OUTLINING before you write. An author typed one",
    "prompt; the Idea and the World in the user turn were derived from it, and nobody will be asked anything.",
    `The film runs EXACTLY ${formatLength(budget.seconds)}: ${budget.scenes} scenes, at most ${budget.dialogueWords} words of dialogue in total`,
    `(in ${language}). Plan the whole story now, so the draft only has to write it.`,
    ...(budget.takes ? ["", ...takesBrief(budget)] : []),
    ...(locked.length ? ["", ...authorLinesBrief(locked), "Place each of them in the scene where it lands hardest."] : []),
    "",
    SCREENWRITER_CRAFT,
    "",
    "Plan it scene by scene. For each scene: its place (a World place name EXACTLY), who DRIVES it (one",
    "character), the value it opens on and the value it closes on (they must differ — the scene turns), the",
    "turn itself (the moment and the choice that flips it), how it follows from the scene before (THEREFORE or",
    "BUT — never \"and then\"), what we see, and how many words of dialogue it spends. The scenes' words add up",
    `to between ${Math.round(budget.dialogueWords * 0.8)} and ${budget.dialogueWords}. Then the plants and their payoffs.`,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "title": string, "logline": string, "arc": string, "argues": string,',
    '  "beats": [{ "name": string, "function": string, "what": string }],',
    '  "scenes": [{ "scene": number, "place": string, "seconds": number, "driver": string, "opens": string,',
    '    "closes": string, "turn": string, "link": string, "what": string, "dialogueWords": number }],',
    '  "plants": [{ "plant": string, "payoff": string }] }',
    "`argues` is what the ending decides, in one sentence the film itself never says.",
  ].join("\n");
  return [{ role: "system", content: system }, user];
}

/** The outline answer → a clean outline. Throws when there is no scene plan. */
export function parseOutline(answer, budget) {
  const scenes = (Array.isArray(answer?.scenes) ? answer.scenes : [])
    .filter((s) => s && typeof s === "object")
    .map((s, i) => ({
      scene: i + 1,
      place: str(s.place), seconds: Number(s.seconds) || null, driver: str(s.driver),
      opens: str(s.opens), closes: str(s.closes), turn: str(s.turn), link: str(s.link), what: str(s.what),
      dialogueWords: Math.max(0, Math.round(Number(s.dialogueWords) || 0)),
    }))
    .filter((s) => s.what || s.turn);
  if (scenes.length < 2) throw new Error(`The outline planned ${scenes.length} scene${scenes.length === 1 ? "" : "s"} — not a film.`);
  if (budget.takes && scenes.length !== budget.takes.length) {
    throw new Error(`The outline planned ${scenes.length} scenes for ${budget.takes.length} takes — a scene is a take.`);
  }
  const list = (v, keys) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object")
    .map((x) => Object.fromEntries(keys.map((k) => [k, str(x[k])]))).filter((x) => keys.some((k) => x[k]));
  return {
    title: str(answer?.title), logline: str(answer?.logline), arc: str(answer?.arc), argues: str(answer?.argues),
    beats: list(answer?.beats, ["name", "function", "what"]).slice(0, 12),
    scenes,
    plants: list(answer?.plants, ["plant", "payoff"]).slice(0, 10),
  };
}

/** The outline as the draft and the revision read it. */
export function formatOutline(o) {
  return [
    o.title && `Title: ${o.title}`,
    o.logline && `Logline: ${o.logline}`,
    o.arc && `Arc: ${o.arc}`,
    o.argues && `What the ending argues (never said aloud): ${o.argues}`,
    "",
    "Scenes:",
    ...o.scenes.map((s) => [
      `${s.scene}. ${s.place || "(place?)"}${s.seconds ? ` · ${s.seconds}s` : ""} · driven by ${s.driver || "?"} · ${s.dialogueWords} words of dialogue`,
      `   ${s.opens || "?"} → ${s.closes || "?"}${s.turn ? ` — turns when ${s.turn}` : ""}`,
      s.link && `   ${s.link}`,
      s.what && `   ${s.what}`,
    ].filter(Boolean).join("\n")),
    ...(o.plants.length ? ["", "Plants and payoffs:", ...o.plants.map((p) => `- ${p.plant} → ${p.payoff}`)] : []),
  ].filter((l) => l !== false && l != null).join("\n");
}

// ── Pass 3: the revision ─────────────────────────────────────────────────────

export function reviseMessages({ world, outline, elements, issues, budget, language = DEFAULT_FILM_LANGUAGE, locked = [], round = 1 }) {
  const system = [
    "You are the screenwriter of StorySeam's Auto pipeline, revising your own draft before anyone shoots it.",
    round > 1
      ? "This is your SECOND revision: the measured problems below survived the first one. Fix them first."
      : "Read it the way the writers' room will. First REVIEW it: go through the craft below scene by scene and",
    ...(round > 1 ? [] : [
      "write down every place it fails — a scene that ends on the charge it opened on, a beat joined by \"and",
      "then\", a choice nobody set up, a line that says the feeling, an ending that states the theme, a hook that",
      "is discussed instead of shown. Then REWRITE the screenplay so none of it is true any more. A note that",
      "asks for a turned scene or a planted cause means changing the scene, not rewording a line.",
    ]),
    "The MEASURED problems in the user turn are not opinions: code counted them, and every one must be gone.",
    "Keep what already works — this is a revision, not a new story.",
    "",
    `The film runs EXACTLY ${formatLength(budget.seconds)}: ${budget.scenes} scenes and at most ${budget.dialogueWords} words of dialogue`,
    `in total, in ${language} only. Every character and place keeps its EXACT World name.`,
    ...(budget.takes ? ["", ...takesBrief(budget)] : []),
    ...(locked.length ? ["", ...authorLinesBrief(locked), "They stay exactly as written, wherever the revision moves them."] : []),
    "",
    SCREENWRITER_CRAFT,
    "",
    SCREENPLAY_FORMAT,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "review": [{ "where": string, "issue": string, "fix": string }], "changes": [string], "title": string,',
    '  "elements": [{ "type": string, "text": string }] }',
    "`review` is what you found (at most twelve); `changes` is one line per change you made (at most twelve);",
    "`elements` is the WHOLE revised screenplay.",
  ].join("\n");
  const user = [
    "THE WORLD BIBLE:",
    worldBrief(world),
    ...(outline ? ["", "YOUR OUTLINE:", formatOutline(outline)] : []),
    "",
    "MEASURED PROBLEMS:",
    issues.length ? issues.map((i) => `- ${i.issue}`).join("\n") : "- none: the draft is on budget. Review it for the craft.",
    "",
    "THE DRAFT:",
    formatScreenplay(elements),
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

// ── One pass (called by the workflow) ────────────────────────────────────────

/**
 * Run pass `pass` of `job`'s Script flow. Idempotent: a pass already on file
 * answers with what it saved. → the pass entry, plus `again` on a revision
 * (whether a hard measured problem is still there — the workflow then runs
 * `revise-2`). deps (optional): { model, readWorld, readStore, saveScriptDraft }.
 */
export async function runScriptPass(env, job, pass, deps = {}) {
  if (!SCRIPT_PASSES.includes(pass)) throw Object.assign(new Error(`Unknown script pass: ${pass}`), { status: 400 });
  const pid = job.projectId;
  const name = scriptDocName(job.id);
  const state = { ...EMPTY, ...(await readDoc(env, pid, name, null)) };
  if (state.passes?.[pass]) return state.passes[pass];

  const world = await (deps.readWorld || readWorld)(env, pid);
  const budget = filmBudgetFor(job);
  const locked = authorLines(job.prompt);
  const language = job.language || DEFAULT_FILM_LANGUAGE;
  const model = deps.model || scriptWriterFor(env, job);
  const idea = state.idea ?? "";
  const started = Date.now();
  const at = () => new Date().toISOString();
  let entry;

  if (pass === "outline") {
    const answer = await model.json({ messages: outlineMessages({ idea, world, budget, language, locked }), maxTokens: 8000, temperature: 0.8 });
    const outline = parseOutline(answer, budget);
    entry = { pass, outline, ms: Date.now() - started, at: at() };
  } else if (pass === "draft") {
    const outline = state.passes?.outline?.outline;
    if (!outline) throw Object.assign(new Error("The script has no outline yet."), { status: 409 });
    const answer = await model.json({
      messages: scriptMessages({ idea, world, budget, language, locked, outline: formatOutline(outline) }),
      maxTokens: 16000,
      temperature: 0.7,
    });
    const script = parseScript(answer, world);
    const title = script.title || outline.title;
    const saved = await (deps.saveScriptDraft || saveScriptDraft)(env, pid, { name: "First draft", title, elements: script.elements });
    const issues = scriptIssues(script.elements, { budget, world, locked });
    entry = {
      pass, title, logline: script.logline || outline.logline, arc: script.arc || outline.arc,
      beats: script.beats.length ? script.beats : outline.beats,
      ...saved, ...screenplayStats(script.elements), issues, missing: missingLines(locked, script.elements), ms: Date.now() - started, at: at(),
    };
  } else {
    const round = pass === "revise-2" ? 2 : 1;
    const store = await (deps.readStore || readStore)(env, pid);
    const draft = pinnedDraft(store);
    const elements = docToElements(draft?.doc);
    if (elements.length < 8) throw Object.assign(new Error("The Film has no draft to revise — the draft pass did not finish."), { status: 409 });
    const issues = scriptIssues(elements, { budget, world, locked });
    const answer = await model.json({
      messages: reviseMessages({ world, outline: state.passes?.outline?.outline, elements, issues, budget, language, locked, round }),
      maxTokens: 20000,
      temperature: 0.5,
    });
    const rewrite = parseRewrite(answer, draft.title || world.title);
    const review = (Array.isArray(answer?.review) ? answer.review : [])
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ where: str(r.where), issue: str(r.issue), fix: str(r.fix) }))
      .filter((r) => r.issue)
      .slice(0, 12);
    // The author's lines, checked in code, as the room does: put back where they were, or the revision is not used.
    // Only a line the draft HAD can be put back; one it never had stays a measured problem.
    const had = locked.filter((l) => !missingLines([l], elements).length);
    const kept = restoreLines(had, elements, rewrite.elements);
    const after = kept ? kept.elements : elements;
    const left = scriptIssues(after, { budget, world, locked });
    // A revision that made the measured problems worse is not an improvement: keep the draft it read.
    const worse = kept && left.filter((i) => i.hard).length > issues.filter((i) => i.hard).length;
    if (kept && !worse) {
      const changes = [...kept.restored.map((l) => `Kept the author's line “${l}” as written.`), ...rewrite.changes].slice(0, 12);
      const saved = await (deps.saveScriptDraft || saveScriptDraft)(env, pid, {
        name: round > 1 ? "Revised draft · 2" : "Revised draft", title: rewrite.title, elements: after,
      });
      entry = { pass, title: rewrite.title, review, changes, ...saved, ...screenplayStats(after), issues: left, missing: missingLines(locked, after), fixed: issues.length - left.length };
    } else {
      console.warn("film script: the revision was not used", job.id, pass, kept ? "more measured problems" : "dropped the author's lines");
      entry = {
        pass, title: draft.title || rewrite.title, review, kept: true,
        changes: [kept ? "The revision measured worse than the draft, so the draft was kept." : "The revision changed the author's own lines, so the draft was kept."],
        draftId: draft.id, draftName: draft.name, updatedAt: draft.updatedAt, ...screenplayStats(elements), issues, missing: missingLines(locked, elements), fixed: 0,
      };
    }
    entry = { ...entry, again: round === 1 && entry.issues.some((i) => i.hard), ms: Date.now() - started, at: at() };
  }

  await updateDoc(env, pid, name, { ...EMPTY }, (d) => {
    d.passes = d.passes || {};
    d.passes[pass] = entry;
  });
  return entry;
}

/** The workflow's last word: `done`, or `failed` with the reason. */
export async function finishScript(env, pid, filmId, { status, error }) {
  const ok = status === "done";
  await updateDoc(env, pid, scriptDocName(filmId), { ...EMPTY }, (d) => {
    d.status = ok ? "done" : "failed";
    d.error = ok ? null : str(error).slice(0, 600) || "The script flow stopped.";
    d.endedAt = new Date().toISOString();
  });
  return { ok: true };
}

// ── The workflow, on the flue worker ─────────────────────────────────────────

export function startScriptWorkflow(env, job, { instanceId }) {
  return flueFetch(env, `/scripts/${encodeURIComponent(instanceId)}`, {
    userId: job.userId,
    what: "The script flow",
    method: "POST",
    body: { filmId: job.id, projectId: job.projectId, userId: job.userId, episodeId: job.episodeId || null },
  });
}

export function scriptWorkflowStatus(env, job, instanceId) {
  return flueFetch(env, `/scripts/${encodeURIComponent(instanceId)}`, { userId: job.userId, what: "The script flow" });
}

// ── The stage ────────────────────────────────────────────────────────────────

const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;

/** The pass whose draft is the script now: the last one on file that saved a draft. */
function lastDraftPass(state) {
  return ["revise-2", "revise-1", "draft"].map((p) => state.passes?.[p]).find((p) => p?.draftId) || null;
}

function progress(state) {
  const p = state.passes || {};
  if (!p.outline) return "Outlining — the arc, and a plan for every scene";
  if (!p.draft) return `Writing the first draft from the outline · ${n(p.outline.outline.scenes.length, "scene")} planned`;
  if (!p["revise-1"]) {
    const hard = (p.draft.issues || []).length;
    return `Revising the first draft${hard ? ` · ${n(hard, "measured problem")} to fix` : " against the craft"}`;
  }
  if (p["revise-1"].again && !p["revise-2"]) return "A second revision — a measured problem survived the first";
  return "Saving the script";
}

/** The step's result: what the Film card and its Script dialog show. */
function view(state, job, budget, locked) {
  const p = state.passes || {};
  const outline = p.outline?.outline || null;
  const last = lastDraftPass(state);
  const revisions = ["revise-1", "revise-2"].map((k) => p[k]).filter(Boolean)
    .map((r) => ({ pass: r.pass, draftName: r.draftName, kept: !!r.kept, review: r.review || [], changes: r.changes || [], issues: (r.issues || []).map((i) => i.issue) }));
  const dropped = last?.missing || [];
  return {
    ...(locked.length ? { authorLines: locked } : {}),
    ...(dropped.length ? { missingAuthorLines: dropped } : {}),
    title: last?.title || p.draft?.title || outline?.title || null,
    logline: p.draft?.logline || outline?.logline || null,
    arc: p.draft?.arc || outline?.arc || null,
    argues: outline?.argues || null,
    beats: p.draft?.beats || outline?.beats || [],
    ...(outline ? { outline: outline.scenes } : {}),
    ...(last ? {
      scenes: last.scenes, lines: last.lines, words: last.words, dialogueWords: last.dialogueWords, spokenSeconds: last.spokenSeconds,
      draftId: last.draftId, draftName: last.draftName, updatedAt: last.updatedAt,
      issues: (last.issues || []).map((i) => i.issue),
    } : {}),
    ...(revisions.length ? { revisions } : {}),
    passes: SCRIPT_PASSES.filter((k) => p[k]),
    budget,
  };
}

/** deps (optional): { startScript, scriptStatus } — tests pass fakes. */
export async function runScriptStage({ job, results, env, attempt = 1 }, deps = {}) {
  const pid = job.projectId;
  const name = scriptDocName(job.id);
  const budget = filmBudgetFor(job);
  const locked = authorLines(job.prompt);
  let state = { ...EMPTY, ...(await readDoc(env, pid, name, null)) };

  if (state.status === "done") {
    const r = view(state, job, budget, locked);
    const revised = (r.revisions || []).filter((x) => !x.kept).length;
    return {
      summary: [
        `“${r.title || "Untitled"}” — ${n(r.scenes ?? 0, "scene")} · ${n(r.lines ?? 0, "line")} · ${n(r.dialogueWords ?? 0, "word")} of dialogue`,
        revised ? `outlined, drafted, revised ×${revised}` : "outlined and drafted",
        r.missingAuthorLines?.length ? `missing ${r.missingAuthorLines.map((l) => `“${l}”`).join(", ")}` : "",
      ].filter(Boolean).join(" · "),
      result: r,
    };
  }

  const failed = state.status === "failed";
  const needStart = !state.instanceId || (failed && state.startedAttempt !== attempt);
  if (failed && !needStart) throw new Error(state.error || "The script flow stopped.");

  if (needStart) {
    const k = (state.starts || 0) + 1;
    const instanceId = `script-${job.id}-${k}`;
    // The Idea rides in the doc, where every pass reads it: the workflow only carries ids.
    const idea = results?.world?.idea || "";
    await updateDoc(env, pid, name, { ...EMPTY }, (d) => { d.idea = idea; });
    await (deps.startScript || startScriptWorkflow)(env, job, { instanceId });
    const at = new Date().toISOString();
    await updateDoc(env, pid, name, { ...EMPTY }, (d) => {
      Object.assign(d, { instanceId, starts: k, startedAttempt: attempt, status: "running", error: null, startedAt: d.startedAt || at });
    });
    state = { ...state, idea, instanceId, starts: k, startedAttempt: attempt, status: "running" };
    return { pending: true, pollMs: SCRIPT_POLL_MS, summary: progress(state), result: view(state, job, budget, locked) };
  }

  // Still running. Ask Cloudflare too, so a workflow that died without
  // reporting (its finish step never ran) does not leave the Film waiting.
  try {
    const wf = await (deps.scriptStatus || scriptWorkflowStatus)(env, job, state.instanceId);
    if (wf?.status === "errored" || wf?.status === "terminated") {
      const reason = wf.error?.message || wf.error || `the workflow ${wf.status}`;
      await finishScript(env, pid, job.id, { status: "failed", error: String(reason) });
      throw new Error(`The script flow stopped: ${reason}`);
    }
  } catch (err) {
    if (String(err?.message || "").startsWith("The script flow stopped")) throw err;
    console.warn("film script: status check failed", job.id, String(err?.message || err));
  }
  return { pending: true, pollMs: SCRIPT_POLL_MS, summary: progress(state), result: view(state, job, budget, locked) };
}
