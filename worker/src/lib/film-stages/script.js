// The Film job's "Script" stage — the screenplay, right after the World.
//
// A Film used to go from the World straight to a shot list: one model call
// planned the story, the staging, the camera and the dialogue at once, with
// nothing between the Idea and the render, and the stories came back thin —
// a premise illustrated rather than a story told. The chat has a writers' room
// of fifteen specialists for exactly that (src/lib/specialists.ts), but a Film
// runs on the Worker with nobody to ask, so it gets ONE screenwriter that
// carries the room's non-negotiables (SCREENWRITER_CRAFT below — the scene
// doctor's turn, the motivation doctor's "therefore", the character doctor's
// defining choice, the theme doctor's ending, the dialogue doctor's subtext,
// the tension doctor's hook, the producer's limits) and writes to the Film's
// length. A Deep Film then sends that draft through the real room
// (./room.js); a fast one shoots it.
//
// The script is saved as the Film project's PINNED draft through the same
// store the Script tab and the agent's get_script read (lib/script-store.js),
// so the Film's project opens with its screenplay where a screenplay goes, and
// both Shot list stages cut it from there instead of inventing the story.
import { planFilm, planH3, planStoryFlow, formatLength } from "../film-plan.ts";
import { authorLines, authorLinesBrief, missingLines } from "./author-lines.js";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { readWorld } from "../../routes/world.js";
import { makeDraft, nowIso, updateStore } from "../script-store.js";
import { cleanElements, elementsToDoc, screenplayStats, WORDS_PER_SECOND } from "../script-elements.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** The Film's plan, whichever engine makes it (a story engine's carries its takes). */
const filmPlanFor = (job) =>
  job?.engine === "seedance"
    ? planStoryFlow({ prompt: job.prompt, seconds: job.seconds ?? null })
    : job?.engine === "h3"
      ? planH3({ prompt: job.prompt, seconds: job.seconds ?? null })
      : planFilm({ prompt: job?.prompt, seconds: job?.seconds ?? null });

/** The Film's length in seconds, whichever engine makes it. */
export const filmSecondsFor = (job) => filmPlanFor(job).seconds;

/**
 * The TAKES a story engine will shoot the Film in — its segment lengths in
 * seconds, in order (film-plan.ts segmentDurations: Seedance up to 30s each,
 * H3 up to 15) — or null for the Director, whose cue sheet is not cut that way.
 */
export const filmTakesFor = (job) => {
  const plan = filmPlanFor(job);
  return Array.isArray(plan.durations) && plan.durations.length ? plan.durations : null;
};

/**
 * What a film of `seconds` can hold. Dialogue is about two thirds of the
 * runtime and plays at WORDS_PER_SECOND; the rest is action the camera shows.
 * Scenes: one per ~35s, a minute gets two, five minutes gets eight — unless
 * the film is shot in TAKES (a story engine's segments), in which case a
 * scene IS a take: one per segment, written to that segment's seconds, so the
 * Shot list can cut the screenplay onto the grid without splitting a scene
 * across a seam or squeezing two into one generation.
 */
export function scriptBudget(seconds, takes = null) {
  const dialogueWords = Math.round(seconds * (2 / 3) * WORDS_PER_SECOND);
  if (Array.isArray(takes) && takes.length) {
    return { seconds, dialogueWords, scenes: takes.length, takes };
  }
  const scenes = Math.min(8, Math.max(2, Math.round(seconds / 35)));
  return { seconds, dialogueWords, scenes, takes: null };
}

/** The Script and Writers' room stages' budget for this job: its length, and its takes when it has them. */
export const filmBudgetFor = (job) => scriptBudget(filmSecondsFor(job), filmTakesFor(job));

/**
 * The lines that tell the writer about the takes — what each scene must fit
 * — or nothing when the film is not shot in takes.
 */
export function takesBrief(budget) {
  const takes = budget?.takes;
  if (!Array.isArray(takes) || !takes.length) return [];
  const words = (d) => Math.round(d * (2 / 3) * WORDS_PER_SECOND);
  return [
    `THE TAKES: the film is generated as ${takes.length} continuous take${takes.length === 1 ? "" : "s"}, in order, and a scene IS a take —`,
    "one scene per take, in this order, each in one place, its action and dialogue sized to its seconds:",
    ...takes.map((d, i) => `  scene ${i + 1}: ${d}s (about ${words(d)} words of dialogue at most)`),
    "A take cannot be cut inside: a scene never changes place or jumps in time mid-take, and a scene that",
    "runs long spills into the next take and is cut short. Write each scene to its take's length exactly.",
  ];
}

// What the room would say, folded into the writer before it writes — one rule
// per specialist that a first draft most often breaks.
export const SCREENWRITER_CRAFT = [
  "THE CRAFT — every one of these is checked afterwards; write to them now:",
  "- Shape (the story architect): pick ONE arc that fits the Idea — three-act, story circle, kishōtenketsu,",
  "  hero's journey, save the cat — and map the beats onto it: a beginning, a turn, an ending. Name it in `arc`.",
  "- Every scene TURNS (the scene doctor): a scene carries a value charge for whoever's scene it is",
  "  (safe/exposed, together/alone, hopeful/beaten) and that charge FLIPS across it. A scene that ends on the",
  "  charge it opened on is a deleted scene. Enter late — cut to the first line that can't be predicted —",
  "  and leave early, right after the turn lands. Exactly one character drives each scene.",
  "- Cause, not sequence (the motivation doctor): beats connect by THEREFORE and BUT, never \"and then\".",
  "  Every choice is caused by a want, a fear or a wound the audience has seen; luck may make problems,",
  "  never solve them; a change of heart is planted before it arrives.",
  "- Plant and pay (the plot doctor): whatever the ending needs was shown earlier; nothing shown matters",
  "  only once; nobody knows what they were never told.",
  "- Legible people (the character doctor): each character makes at least one choice under pressure only",
  "  they would make; each has one trait and ONE contradiction that costs them; nobody says who they are —",
  "  they do it. With the names stripped off, the lines could still be reassigned.",
  "- Argued, not stated (the theme doctor): the ending decides what the film argues; the other side has a",
  "  champion who is not a fool and looks like winning for a stretch; the theme is never spoken aloud.",
  "- Pressure that climbs (the tension doctor): the first fifteen seconds hook — a want and a risk on",
  "  screen, not discussed. The curve rises with a breath before the climax; no three scenes at one level.",
  "- Subtext (the dialogue doctor): people say what they'd say, not what the audience needs; the true",
  "  thing is done or implied instead of said; voices are distinct and short; the button line lands last;",
  "  no exposition dumps, no one narrating a feeling.",
  "- Rendered, not shot (the producer): this is generated shot by shot by image and video models. At most",
  "  three characters in a frame, no crowds, no legible on-screen text, no animals that are not in the",
  "  World, no fine hand work; every scene in one of the World's places; the cast is the World's cast.",
  "- Speakable (the performance doctor): lines go to a voice model — no numerals, abbreviations,",
  "  homographs or run-ons; write what is SAID.",
].join("\n");

// The Script tab's line types, as the script-writing playbook defines them.
export const SCREENPLAY_FORMAT = [
  "THE FORMAT — a flat list of screenplay lines, each { type, text }, type one of:",
  '- "scene_heading" — INT./EXT. PLACE - TIME, the place being one of the World\'s place names EXACTLY.',
  '- "action" — present tense, what we see and hear; names every character present by their EXACT World name.',
  '- "character" — the speaker\'s cue: their EXACT World name, nothing else.',
  '- "dialogue" — the words spoken, right after a character line.',
  '- "parenthetical" — a short delivery note, lowercase, e.g. (quietly). Sparingly.',
  '- "transition" — CUT TO: / FADE OUT. Only where a cut carries meaning.',
].join("\n");

export function scriptMessages({ idea, world, budget, language = DEFAULT_FILM_LANGUAGE, locked = [] }) {
  const cast = (world.characters || [])
    .map((c) => {
      const bits = [c.role, c.want && `wants ${c.want}`, c.need && `needs ${c.need}`, c.traits, c.arc && `arc: ${c.arc}`, c.voice && `voice: ${c.voice}`]
        .map(str).filter(Boolean);
      return `- ${c.name}${bits.length ? ` — ${bits.join("; ")}` : ""}`;
    })
    .join("\n");
  const places = (world.locations || []).map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`).join("\n");
  const system = [
    "You are the screenwriter of StorySeam's Auto pipeline. An author typed one prompt; the Idea and the",
    "World below were derived from it, and nobody will be asked anything: you write the screenplay of a",
    `short film that runs EXACTLY ${formatLength(budget.seconds)} on screen. Tell the story completely.`,
    "",
    `THE BUDGET: ${budget.scenes} scenes (one place each; the same place may return), and at most`,
    `${budget.dialogueWords} words of dialogue in total — dialogue plays at about ${WORDS_PER_SECOND} words a second and`,
    "is two thirds of the runtime; the rest is what the camera shows. Over the budget, the film is cut short.",
    `Dialogue is in ${language}, and only ${language}.`,
    ...(budget.takes ? ["", ...takesBrief(budget)] : []),
    ...(locked.length ? ["", ...authorLinesBrief(locked)] : []),
    "",
    SCREENWRITER_CRAFT,
    "",
    SCREENPLAY_FORMAT,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "title": string, "logline": string, "arc": string,',
    '  "beats": [{ "name": string, "function": string, "what": string }],',
    '  "elements": [{ "type": string, "text": string }] }',
    "`beats` is the outline you wrote from (4–8, in order); `elements` is the whole screenplay.",
  ].join("\n");
  const user = [
    `The Idea: ${idea || "(none)"}`,
    `Title: ${world.title || "(untitled)"}`,
    world.logline ? `Logline: ${world.logline}` : "",
    world.map?.theme ? `Theme: ${world.map.theme}` : "",
    world.map?.stakes ? `Stakes: ${world.map.stakes}` : "",
    world.depth?.premise ? `Premise: ${world.depth.premise}` : "",
    world.depth?.conflict ? `Conflict: ${world.depth.conflict}` : "",
    world.depth?.structure ? `Structure: ${world.depth.structure}` : "",
    "",
    "Characters:",
    cast || "(none)",
    "",
    "Places:",
    places || "(none)",
  ].filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The writer's answer → { title, logline, arc, beats, elements }. Throws when it is not a script. */
export function parseScript(answer, world) {
  const elements = cleanElements(answer?.elements);
  if (elements.length < 8) throw new Error(`The writing model returned ${elements.length} screenplay lines — not a script.`);
  if (!elements.some((el) => el.type === "scene_heading")) throw new Error("The screenplay has no scene heading.");
  if (!elements.some((el) => el.type === "dialogue")) throw new Error("The screenplay has no dialogue.");
  const beats = (Array.isArray(answer?.beats) ? answer.beats : [])
    .filter((b) => b && typeof b === "object")
    .map((b) => ({ name: str(b.name), function: str(b.function), what: str(b.what) }))
    .filter((b) => b.name || b.what)
    .slice(0, 12);
  return {
    title: str(answer?.title) || str(world?.title) || "Untitled",
    logline: str(answer?.logline) || str(world?.logline),
    arc: str(answer?.arc),
    beats,
    elements,
  };
}

/**
 * Save a screenplay as the project's pinned draft. A brand-new project holds
 * one empty draft — that one becomes the script rather than sitting beside it;
 * otherwise a new draft is added and pinned. → { draftId, draftName, updatedAt }
 */
export async function saveScriptDraft(env, pid, { name, title, elements }) {
  let saved = null;
  await updateStore(env, pid, (store) => {
    const doc = elementsToDoc(elements);
    const at = nowIso();
    const empty = store.drafts.length === 1 && !store.drafts[0].doc ? store.drafts[0] : null;
    if (empty) {
      Object.assign(empty, { name, title, doc, updatedAt: at, clientId: null, proposal: null });
      store.pinnedId = empty.id;
      saved = { draftId: empty.id, draftName: name, updatedAt: at };
    } else {
      const d = makeDraft({ name, title, doc });
      store.drafts.push(d);
      store.pinnedId = d.id;
      saved = { draftId: d.id, draftName: name, updatedAt: d.updatedAt };
    }
  });
  return saved;
}

/** deps (optional): { readWorld, saveScriptDraft }. */
export async function runScriptStage({ job, results, env, model }, deps = {}) {
  const pid = job.projectId;
  const world = await (deps.readWorld || readWorld)(env, pid);
  const budget = filmBudgetFor(job);
  const idea = results?.world?.idea || "";
  // Lines the author quoted in the prompt: written verbatim (author-lines.js).
  const locked = authorLines(job.prompt);

  const answer = await model.json({
    messages: scriptMessages({ idea, world, budget, language: job.language || DEFAULT_FILM_LANGUAGE, locked }),
    maxTokens: 16000,
    temperature: 0.8,
  });
  const script = parseScript(answer, world);
  const saved = await (deps.saveScriptDraft || saveScriptDraft)(env, pid, { name: "First draft", title: script.title, elements: script.elements });
  const stats = screenplayStats(script.elements);
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  // Said on the card rather than swallowed: the room's rewrite is told the
  // lines too, but a draft without one is the author's request not kept.
  const dropped = missingLines(locked, script.elements);
  if (dropped.length) console.warn("film script: the draft leaves out the author's line(s)", job.id, dropped);
  return {
    summary: `“${script.title}” — ${n(stats.scenes, "scene")} · ${n(stats.lines, "line")} · ${n(stats.dialogueWords, "word")} of dialogue${dropped.length ? ` · missing ${dropped.map((l) => `“${l}”`).join(", ")}` : ""}`,
    result: {
      ...(locked.length ? { authorLines: locked } : {}),
      ...(dropped.length ? { missingAuthorLines: dropped } : {}),
      title: script.title,
      logline: script.logline,
      arc: script.arc,
      beats: script.beats,
      ...stats,
      budget,
      ...saved,
    },
  };
}
