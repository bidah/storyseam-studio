// The story flow's "Shot list" stage (/story-flow — the Seedance 2.5 Film).
//
// The Director flow cuts a Film into 2–6s shots and pins a drawn frame on a
// ~4s grid. Seedance 2.5 is not driven that way: one generation runs up to 30s
// and is written as a STAGED NARRATIVE — named stages, each with one visible
// change and an observable end state that the next stage (or the next
// generation) inherits. So the list here is a list of SEGMENTS, one per
// generation, their lengths fixed by code (film-plan.ts segmentDurations: 60s
// → 2 × 30s on Seedance, 4 × 15s on H3), each holding up to `maxStagesFor`
// stages (four to six, by its length) written to the engine's skill. The Script
// stage wrote the screenplay to the same grid — one scene per segment — so a
// segment is a scene, and the writer here is told which.
//
// The writer reads the Seedance 2.5 skill whole (./seedance-skill.js) and the
// segment lengths; the prompts themselves are COMPILED from its answer by the
// next stage (./prompts.js), so the reference tokens, the extension clause and
// the look can never be mistyped by a model.
//
// The segments are also saved as the project's ordinary shot list (one shot per
// stage, through the same `saveShotlist` every writer uses) so the Film's
// project opens with its story in the Shot list tab like any other.
import { DEFAULT_FILM_WRITER, H3_SEGMENT_MAX_SECONDS, SEGMENT_MAX_SECONDS, formatLength, maxStagesFor, planH3, planStoryFlow } from "../../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE } from "../../film-sound.js";
import { MUSIC_CUES, MUSIC_CUE_NAMES, musicCueRange, repairMusicCues } from "../../music-cues.ts";
import { readWorld } from "../../../routes/world.js";
import { saveShotlist } from "../../../routes/shotlist.js";
import { SEEDANCE_SKILL } from "./seedance-skill.js";
import { H3_SKILL } from "../h3/h3-skill.js";
import { pinnedDraft, readStore } from "../../script-store.js";
import { docToElements, formatScreenplay } from "../../script-elements.js";
import { writerModel } from "../../writer.js";
import { partLines, repairMessages, screenplayParts, segmentIssues, segmentShotMessages, shotRangeFor } from "./scene-shots.js";

/** The model that cuts every story Film's shots (see runStoryFlowShotlistStage). */
export const SHOTLIST_WRITER = DEFAULT_FILM_WRITER;

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const key = (name) => str(name).toLowerCase().replace(/\s+/g, " ");

// ── The engines this Shot list writes for ───────────────────────────────────
//
// One writer, two video models: the content it writes (segments of staged
// narrative) is the same shape for both, but it reads the SKILL the segment
// prompts are compiled to — Seedance's (./seedance-skill.js) or MiniMax H3's
// (../h3/h3-skill.js, vendored from promptsama) — so the stages it writes are
// the ones that model is prompted with. What differs is named here, once.
export const STORY_ENGINES = {
  seedance: {
    model: "Seedance 2.5",
    skill: SEEDANCE_SKILL,
    /** The longest one generation runs (film-plan.ts SEGMENT_MAX_SECONDS). */
    maxSeconds: SEGMENT_MAX_SECONDS,
    chain: [
      "as a chain of SEGMENTS: each segment is ONE generation, and every segment after the first is a",
      "forward EXTENSION of the one before it (the model is handed the last seconds of the previous segment",
      "and continues from its final frame).",
    ],
    plan: (job) => planStoryFlow({ prompt: job.prompt, seconds: job.seconds ?? null }),
  },
  h3: {
    model: "MiniMax H3",
    skill: H3_SKILL,
    maxSeconds: H3_SEGMENT_MAX_SECONDS,
    chain: [
      "as a chain of SEGMENTS: each segment is ONE generation (Omni Reference: the character and place sheets",
      "go in as Image 1, Image 2 …), and every segment after the first CONTINUES the one before it (the model",
      "is handed the LAST FRAME of the previous segment as an image and opens on it exactly).",
    ],
    plan: (job) => planH3({ prompt: job.prompt, seconds: job.seconds ?? null }),
    // H3 speaks what it can read as speech: a stage name, a quoted title, the
    // words of a voice reference — and it fills unscripted time with mumbling or
    // a repeat. So on H3 the lines are DATA, apart from the sound (`lines`), and
    // the compiler (h3/prompts.js) writes them in H3's own dialogue syntax.
    // Measured on film-1fd51691 (2026-09-27): "The decision." (a stage name),
    // "Segment two of Concrete King" (the prompt's lock), "It's still down by
    // the river" (the audition), and a line said twice.
    lines: true,
    dialogue: [
      "- DIALOGUE on MiniMax H3 is the most fragile thing in the film. Spoken words go ONLY in a stage's",
      "  `lines`: [{ \"speaker\", \"delivery\", \"text\" }] — `speaker` a World name EXACTLY, `delivery` a few",
      "  plain words (volume, pace, emotion: \"quiet, steady\"), `text` the exact words and nothing else, no",
      "  quotation marks, ending in . ? or !. A stage with no speech has `lines: []`.",
      "- Every screenplay line is spoken VERBATIM, once, in the stage where it lands. Never paraphrase,",
      "  never add a line the screenplay does not have, never repeat one.",
      "- A line FITS its stage: at most 2.5 words per second of the stage, and never more than 18 words in",
      "  one line. A longer screenplay line is split at a sentence break across consecutive stages — the",
      "  words themselves unchanged. Leave at least one second of the stage without speech.",
      "- At most two lines in a stage, and never two from the same speaker back to back: one speaker's turn,",
      "  then the other's. A character with a line is on screen and facing the camera in that stage, in a",
      "  medium shot or closer, so the mouth can be read.",
      "- `audio` is SOUND ONLY — ambience and effects as plain prose, no speech, no quotation marks. No",
      "  voices without words either: never chatter, calls, shouting, murmurs or overlapping voices (in",
      "  `audio` or in the `sound` direction) — H3 turns a voice with no line into gibberish. A crowd is",
      "  footsteps, movement and traffic.",
      "- No quotation marks anywhere else: not in `name`, `goal`, `event`, `camera` or `end`. H3 reads a",
      "  quoted phrase as a line to speak. Titles and stage names are labels, never spoken.",
    ],
  },
};
/** The engine profile for a job (Seedance's when the job names none). */
export const storyEngineOf = (engine) => STORY_ENGINES[engine] || STORY_ENGINES.seedance;

/** The story-flow plan for this job: its length and segment lengths, by its engine. */
export const storyFlowPlanFor = (job) => storyEngineOf(job?.engine).plan(job);

export function storyFlowShotlistMessages({ idea, world, durations, screenplay = [], language = DEFAULT_FILM_LANGUAGE, engine = "seedance" }) {
  const seconds = durations.reduce((a, b) => a + b, 0);
  const eng = storyEngineOf(engine);
  const scenes = screenplay.filter((el) => el?.type === "scene_heading").length;
  const [lo, hi] = musicCueRange(seconds);
  const cast = (world.characters || []).map((c) => `- ${c.name}${c.role ? ` — ${c.role}` : ""}`).join("\n");
  const places = (world.locations || [])
    .map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`)
    .join("\n");
  const propList = (world.props || [])
    .map((p) => `- ${p.name}${p.owner ? ` (${p.owner}'s)` : ""}${p.description ? `: ${p.description}` : ""}`)
    .join("\n");
  const system = [
    `You are the writing room of StorySeam's story flow. A short film will be generated by ${eng.model} on fal,`,
    ...eng.chain,
    ...(screenplay.length
      ? [
          "The SCREENPLAY below is the story — walk it IN ORDER, nobody will be asked anything: each scene",
          "heading is a place the segments move through, every line of dialogue is spoken VERBATIM in the stage",
          `it lands on (${eng.lines ? "`lines`" : "`audio`, speaker and delivery before it"}), and the action is what the screenplay shows.`,
          `Do not add scenes, characters or lines the screenplay does not have. The film is ${formatLength(seconds)}.`,
          ...(scenes === durations.length
            ? [
                `It was written to this film's grid — ONE scene per segment, in order — so segment ${durations.length === 1 ? "1 is scene 1" : `k is scene k`}:`,
                "its place, its action, its lines, in its seconds. Keep that mapping; do not merge or split scenes.",
              ]
            : []),
        ]
      : [
          "There is no screenplay and nobody to ask: the Idea and the World",
          `below ARE the story. Tell it completely — a beginning, a turn, an ending — in ${formatLength(seconds)}.`,
        ]),
    "",
    `The film is exactly ${durations.length} segment${durations.length === 1 ? "" : "s"}, with these lengths in seconds, in order,`,
    "each with the most stages it may hold:",
    ...durations.map((d, i) => `  segment ${i + 1}: ${d}s, up to ${maxStagesFor(d)} stages`),
    "Write exactly that many segments, in that order.",
    "",
    `How ${eng.model} is prompted — the skill every segment is written to (you write the CONTENT; the`,
    "studio compiles the reference map, the reference tokens, the look and the continuation clause itself):",
    "",
    "<<<SKILL",
    eng.skill,
    "SKILL>>>",
    "",
    "For this film:",
    `- A segment (at most ${eng.maxSeconds}s — ONE continuous ${eng.model} take) has STAGES, one per visible beat,`,
    "  about 5–8s each and never more than its cap above; each stage has ONE primary visible change and an",
    "  observable END STATE (positions, who holds what, screen direction, what is visibly true). A long",
    "  segment is a whole scene played through, not a burst of short shots: let a beat breathe.",
    "- `seconds` per stage: how long it gets; a segment's stages add up to that segment's length.",
    "- Segment 2 onward CONTINUES from the previous segment's last end state: its first stage's `initial`",
    "  restates that end state (same place, same positions) unless the stage itself is a cut to somewhere new.",
    "- `location` is one of the World's place NAMES below, exactly; a segment happens in one place.",
    "- `characters` lists who appears in the segment, using the World's names EXACTLY. Name every character",
    "  by that name in every field (never \"he\" or \"the pilot\") — each is bound to a reference by name.",
    "- `props` lists the World's PROPS (names below, EXACTLY) that are seen in the segment — each is bound to",
    "  its own reference image, apart from the characters, whose references are drawn EMPTY-HANDED. So a prop",
    "  is in a character's hands only where a stage says so: name the prop by its name, say who picks it up,",
    "  holds, uses or hands it over in `event`, and who holds it (or where it lies) in every `end`. A prop not",
    "  in `props` is not in the segment. An object the World does not list is not a prop — keep it incidental.",
    ...(eng.lines
      ? [...eng.dialogue, `- Every line is in ${language} only.`]
      : [
          `- \`audio\` is plain prose: named speaker + delivery before any line, the line itself in double quotes,`,
          `  in ${language} only; then ambience and effects.`,
        ]),
    "- NEVER music in `audio`: no score, no soundtrack, no singing, no humming — the music is laid under the",
    "  finished film later, and music the model bakes in cannot be removed. No subtitles, no captions, no",
    "  on-screen text. (The `sound` direction obeys the same rule.)",
    "- `camera` is shot size, angle and movement, plainly. No decorative adjectives, no look/style words —",
    "  the look is added for you.",
    "- `goal` is one sentence: what this segment shows.",
    "- `environment` is THIS segment's place at this moment — its light, time of day, weather, what is",
    "  physically there — and `sound` its sound bed (ambience and effects, never music, never speech). Each",
    "  describes ONLY this segment's `location`, never another place of the film and never a change of place:",
    "  the video model renders every place a prompt names.",
    "",
    "THE MUSIC. Beside the segments, write where the score turns — a list of music cues. Each cue starts",
    "at a STAGE (`startShot`, the 1-based position of the stage counting every segment's stages in order)",
    "and runs until the next cue. `cue` is EXACTLY one of these names and nothing else:",
    ...MUSIC_CUE_NAMES.map((n) => `  ${n}${MUSIC_CUES[n].family === "none" ? " — no music at all" : ` (${MUSIC_CUES[n].family})`}`),
    `- ${lo}–${hi} cues for this film. The FIRST cue starts at stage 1.`,
    "- Change the cue ONLY where the story TURNS (a discovery, a threat, a chase begins, a loss, a win) —",
    "  never at every new stage. Each cue lasts at least ~8 seconds of film.",
    "- `silence` is the score stopping on purpose: a held breath before a big action, a heavy exchange",
    "  of dialogue, a reveal. Use 2–3 per film, 4–15 seconds each, and never as the first or the last cue.",
    "- `energy` is 1 (barely there) to 5 (everything); `note` is a few words on why the music turns here.",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "direction": { "environment": string, "camera": string, "sound": string },',
    '  "segments": [{ "title": string, "goal": string, "location": string, "characters": [string], "props": [string],',
    '    "environment": string, "sound": string,',
    '    "stages": [{ "name": string, "seconds": number, "initial": string, "event": string, "camera": string,',
    `      "audio": string,${eng.lines ? ' "lines": [{ "speaker": string, "delivery": string, "text": string }],' : ""} "end": string }] }],`,
    '  "music": [{ "startShot": number, "cue": string, "energy": number, "note": string }] }',
    "`direction` is the whole film's: the era and season, the camera language, the texture of the sound.",
    "It is pasted, word for word, into EVERY segment's prompt, so each field must be true at every second of every",
    "segment: constant qualities (palette, light quality, era, lens and movement style, the texture of the sound),",
    "never a progression. Never name a place or a scene, never write \"starts with… moves to… ends at…\" — a",
    "segment told the film's journey plays the whole journey in its fifteen seconds; a field that names a",
    "place is thrown away. What changes from place to place belongs in each segment's `environment` and `sound`.",
  ].join("\n");
  const user = [
    `The Idea: ${idea || "(none)"}`,
    `Title: ${world.title || "(untitled)"}`,
    world.logline ? `Logline: ${world.logline}` : "",
    world.depth?.structure ? `Structure: ${world.depth.structure}` : "",
    "",
    "Characters:",
    cast || "(none)",
    "",
    "Places:",
    places || "(none)",
    "",
    "Props:",
    propList || "(none)",
    ...(screenplay.length ? ["", "The screenplay:", formatScreenplay(screenplay)] : []),
  ].filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Stage seconds → whole seconds that add up to `total`, each ≥ 1, in
 * proportion to what was asked (evenly when nothing was).
 */
export function fitSeconds(asked, total) {
  const n = asked.length;
  if (!n) return [];
  const given = asked.map((x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0));
  const known = given.filter((x) => x > 0);
  // A stage the writer gave no time gets the average of the ones it did.
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const w = given.map((x) => x || mean);
  const sum = w.reduce((a, b) => a + b, 0);
  const share = sum > 0 ? w.map((x) => (x / sum) * total) : Array(n).fill(total / n);
  const out = share.map((x) => Math.max(1, Math.floor(x)));
  let left = total - out.reduce((a, b) => a + b, 0);
  // Hand the remainder to the stages that lost the most to rounding.
  const order = share.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k]] += 1;
  for (let i = n - 1; left < 0 && i >= 0; i--) {
    const take = Math.min(out[i] - 1, -left);
    out[i] -= take;
    left += take;
  }
  return out;
}

/**
 * The writer's answer + the World + the fixed lengths → the segments.
 * Exactly `durations.length` of them (a short answer is refused; extras are
 * dropped), each in a World place and with World names, its stages capped by
 * its length (`maxStagesFor`) and their seconds fitted to it. Throws when the
 * answer cannot make a film.
 */
export function parseSegments(answer, world, durations, { maxStages = maxStagesFor } = {}) {
  const raw = Array.isArray(answer?.segments) ? answer.segments : [];
  if (raw.length < durations.length) {
    throw new Error(`The writing model returned ${raw.length} of ${durations.length} segments.`);
  }
  const places = new Map((world.locations || []).filter((l) => str(l?.name)).map((l) => [key(l.name), l]));
  const people = new Map((world.characters || []).filter((c) => str(c?.name)).map((c) => [key(c.name), c.name]));
  const things = new Map((world.props || []).filter((p) => str(p?.name)).map((p) => [key(p.name), p.name]));
  let lastPlace = null;

  const segments = durations.map((dur, i) => {
    const s = raw[i] && typeof raw[i] === "object" ? raw[i] : {};
    const stagesRaw = (Array.isArray(s.stages) ? s.stages : [])
      .filter((st) => st && typeof st === "object" && (str(st.event) || str(st.end)))
      .slice(0, typeof maxStages === "function" ? maxStages(dur) : maxStages);
    if (!stagesRaw.length) throw new Error(`Segment ${i + 1} came back with no stages.`);
    const secs = fitSeconds(stagesRaw.map((st) => st.seconds), dur);
    const place = places.get(key(s.location)) || lastPlace || [...places.values()][0] || null;
    lastPlace = place;
    const characters = [...new Set((Array.isArray(s.characters) ? s.characters : [])
      .map((n) => people.get(key(n)))
      .filter(Boolean))];
    // The World's props seen here, in the World's spelling. A prop the writer
    // left out of `props` but named in the stages is still bound: the stage
    // text puts it in the frame whatever the list says.
    const said = [s.goal, ...(Array.isArray(s.stages) ? s.stages : []).flatMap((st) => [st?.initial, st?.event, st?.end])]
      .map((t) => key(t)).join(" ");
    const props = [...new Set([
      ...(Array.isArray(s.props) ? s.props : []).map((n) => things.get(key(n))),
      ...[...things.entries()].filter(([k]) => said.includes(k)).map(([, n]) => n),
    ].filter(Boolean))];
    return {
      index: i,
      dur,
      title: str(s.title) || `Segment ${i + 1}`,
      goal: str(s.goal),
      location: place?.name || str(s.location) || "",
      locationSlug: place?.slug || "",
      characters,
      props,
      // This segment's own place at this moment and its sound bed — what the
      // compilers paste instead of the film-wide direction (./direction.js).
      environment: str(s.environment),
      sound: str(s.sound),
      stages: stagesRaw.map((st, j) => ({
        name: str(st.name) || `Stage ${j + 1}`,
        seconds: secs[j],
        initial: str(st.initial),
        event: str(st.event),
        camera: str(st.camera),
        audio: str(st.audio),
        // H3's spoken lines, apart from the sound (STORY_ENGINES.h3.lines);
        // absent for Seedance, whose lines stay inside `audio`.
        ...(Array.isArray(st.lines) ? { lines: parseLines(st.lines, people) } : {}),
        end: str(st.end),
      })),
    };
  });
  const d = answer?.direction && typeof answer.direction === "object" ? answer.direction : {};
  return {
    segments,
    direction: { environment: str(d.environment), camera: str(d.camera), sound: str(d.sound) },
  };
}

/**
 * A stage's `lines` as the writer wrote them → [{ speaker, delivery, text }]:
 * the speaker in the World's spelling (kept as written when it names nobody
 * in the World), the words unwrapped from any quotation marks the writer put
 * round them anyway, and a line with no words dropped.
 */
export function parseLines(raw, people = new Map()) {
  return (raw || [])
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      speaker: people.get(key(l.speaker)) || str(l.speaker),
      delivery: str(l.delivery),
      text: str(l.text).replace(/^["\u201c]+|["\u201d]+$/g, "").trim(),
    }))
    .filter((l) => l.text);
}

/** Segments → the project's shot list: one shot per stage. */
export function segmentShots(segments) {
  return segments.flatMap((seg) =>
    seg.stages.map((st) => ({
      beat: `S${seg.index + 1}`,
      beatTitle: seg.title,
      location: seg.locationSlug || seg.location,
      dur: st.seconds,
      characters: seg.characters,
      camera: st.camera,
      action: [st.event, st.end && `Ends: ${st.end}`].filter(Boolean).join(" "),
      dialogue: st.lines
        ? st.lines.map((l) => `${l.speaker}: "${l.text}"`).join(" ")
        : (st.audio.match(/"[^"]+"/g) || []).join(" "),
      audioSync: st.lines?.length
        ? [...st.lines.map((l) => `${l.speaker}${l.delivery ? `, ${l.delivery}` : ""}: "${l.text}"`), st.audio].filter(Boolean).join(" ")
        : st.audio,
      prompt: [st.initial, st.event, st.end].filter(Boolean).join(" "),
    })),
  );
}

/**
 * The draft the story stages ENDED on — the room's last rewrite, else the
 * Script stage's — rather than whatever is pinned now. A writers' room
 * workflow instance that outlived its stage pinned a "polish" draft two
 * minutes AFTER film-a45e1cb9's Shot list had read the "draft" one, so the
 * Film's Script tab showed words the film never said. Falls back to the pinned
 * draft (a job from before either stage recorded its draft).
 */
export function storyDraft(store, results) {
  const want = results?.room?.rewrite?.draftId || results?.script?.draftId || null;
  const drafts = Array.isArray(store?.drafts) ? store.drafts : [];
  return (want && drafts.find((d) => d?.id === want)) || pinnedDraft(store);
}

/**
 * The film-wide direction and the music cues, written once the shots exist —
 * `startShot` counts every segment's shots in order, so it needs the whole
 * list. Its own small call; a failure costs the Film its cues, never its shots.
 */
export function directionMusicMessages({ world, idea, segments, seconds }) {
  const [lo, hi] = musicCueRange(seconds);
  let n = 0;
  const list = segments.flatMap((seg) => [
    `Segment ${seg.index + 1} — ${seg.location}: ${seg.goal}`,
    ...seg.stages.map((st) => {
      n += 1;
      const said = (st.lines || []).map((l) => `${l.speaker}: ${l.text}`).join(" / ");
      return `  shot ${n} (${st.seconds}s) ${st.camera ? `[${st.camera}] ` : ""}${st.event}${said ? ` — says: ${said}` : ""}`;
    }),
  ]);
  const system = [
    `You are the music supervisor and director of photography of a ${formatLength(seconds)} short film whose shots are written.`,
    "",
    "1. `direction`: the WHOLE film's constants — `environment` (era, season, palette, light quality),",
    "   `camera` (lens and movement style), `sound` (the texture of the ambience, never music, never speech).",
    "   Pasted into every segment's prompt, so each must be true at every second: never name a place or a",
    "   scene, never a progression (\"starts with… ends at…\").",
    "",
    "2. `music`: where the score turns — a list of cues. Each starts at a SHOT (`startShot`, the shot number",
    "   below) and runs until the next cue. `cue` is EXACTLY one of these names:",
    ...MUSIC_CUE_NAMES.map((c) => `  ${c}${MUSIC_CUES[c].family === "none" ? " — no music at all" : ` (${MUSIC_CUES[c].family})`}`),
    `- ${lo}–${hi} cues. The FIRST cue starts at shot 1.`,
    "- Change the cue ONLY where the story TURNS (a discovery, a threat, a chase, a loss, a win); each cue",
    "  lasts at least ~8 seconds of film.",
    "- `silence` is the score stopping on purpose (a held breath, a heavy exchange, a reveal): 2–3 per film,",
    "  4–15 seconds each, never the first or the last cue.",
    "- `energy` 1 (barely there) to 5 (everything); `note` a few words on why the music turns there.",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "direction": { "environment": string, "camera": string, "sound": string },',
    '  "music": [{ "startShot": number, "cue": string, "energy": number, "note": string }] }',
  ].join("\n");
  const user = [`The Idea: ${idea || "(none)"}`, `Title: ${world.title || "(untitled)"}`, world.logline ? `Logline: ${world.logline}` : "", "", "The shots:", ...list]
    .filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * One segment's shots: the call, the parse, the check, and — when code finds
 * a problem — one more call with the problems sent back. The better of the two
 * answers is kept (fewer problems; the first on a tie), with what is still
 * wrong as `issues` for the Film page. Throws only when no answer makes a
 * segment at all.
 */
export async function writeSegmentShots({ model, messages, world, dur, index, lines, engine }) {
  const attempt = async (msgs) => {
    const answer = await model.json({ messages: msgs, maxTokens: 8000, temperature: 0.6 });
    // A segment answer is the segment itself; accept one wrapped as { segments: [..] } too.
    const one = Array.isArray(answer?.segments) ? answer.segments[0] : answer;
    const seg = { ...(one || {}), stages: Array.isArray(one?.shots) ? one.shots : one?.stages };
    const parsed = parseSegments({ segments: [seg] }, world, [dur], { maxStages: shotRangeFor(dur, engine).max }).segments[0];
    const issues = segmentIssues({ ...parsed, index }, { lines, engine });
    return { answer: one, segment: { ...parsed, index }, issues };
  };
  let first;
  try {
    first = await attempt(messages);
  } catch (err) {
    // No usable segment at all: one retry from scratch before the stage fails.
    console.warn("story shot list: segment retry", index + 1, String(err?.message || err));
    first = await attempt(messages);
    return { ...first, tries: 2 };
  }
  if (!first.issues.length) return { ...first, tries: 1 };
  let second = null;
  try {
    second = await attempt(repairMessages(messages, first.answer, first.issues));
  } catch (err) {
    console.warn("story shot list: repair failed", index + 1, String(err?.message || err));
  }
  const best = second && second.issues.length <= first.issues.length ? second : first;
  return { ...best, tries: 2, fixed: first.issues };
}

/**
 * deps (optional): { readWorld, readStore, saveShotlist, model }.
 *
 * Written by the studio's default writer (`SHOTLIST_WRITER`, Qwen 3.8 on
 * Workers AI) whatever writer the Film chose — the choice of writer is for the
 * story stages; this is a structured cut of a screenplay already written. On
 * Claude it was one call of five minutes and more, and a single call that long
 * is what a deploy kills (film-6767fc11 lost its Shot list twice that way).
 * As ONE call on Qwen it was one 15s stage per segment (film-a45e1cb9) — see
 * ./scene-shots.js for how the list is cut now: a call per segment, in
 * parallel, each checked in code. Measured on that Film's own screenplay
 * (2026-09-29): 33 shots, every line verbatim, 2 minutes; Kimi K2.6 on the
 * same calls took 2–3.5 minutes EACH and ran out of output on three.
 */
export async function runStoryFlowShotlistStage({ job, results, env }, deps = {}) {
  const model = deps.model || writerModel(env, SHOTLIST_WRITER);
  const pid = job.projectId;
  const engine = job.engine === "h3" ? "h3" : "seedance";
  const eng = storyEngineOf(job.engine);
  const world = await (deps.readWorld || readWorld)(env, pid);
  const plan = storyFlowPlanFor(job);
  const idea = results?.world?.idea || "";
  const language = job.language || DEFAULT_FILM_LANGUAGE;
  const draft = storyDraft(await (deps.readStore || readStore)(env, pid), results);
  const screenplay = docToElements(draft?.doc);
  const durations = plan.durations;

  let segments;
  let direction;
  let rawMusic;
  const checks = [];
  if (screenplay.length) {
    const parts = screenplayParts(screenplay, durations.length);
    const names = (world.characters || []).map((c) => c.name);
    const written = await Promise.all(durations.map((dur, i) => {
      const lines = partLines(parts[i]?.elements, names);
      return writeSegmentShots({
        model, world, dur, index: i, lines, engine,
        messages: segmentShotMessages({
          eng, engineId: engine, world, idea, screenplay, part: parts[i], prev: parts[i - 1] || null, next: parts[i + 1] || null,
          index: i, durations, language,
        }),
      });
    }));
    segments = written.map((w) => w.segment);
    written.forEach((w, i) => checks.push({ segment: i + 1, tries: w.tries, ...(w.fixed?.length ? { fixed: w.fixed } : {}), ...(w.issues.length ? { issues: w.issues } : {}) }));
    try {
      const dm = await model.json({ messages: directionMusicMessages({ world, idea, segments, seconds: plan.seconds }), maxTokens: 4000, temperature: 0.5 });
      const d = dm?.direction && typeof dm.direction === "object" ? dm.direction : {};
      direction = { environment: str(d.environment), camera: str(d.camera), sound: str(d.sound) };
      rawMusic = dm?.music;
    } catch (err) {
      console.warn("story shot list: direction + music failed", job.id, String(err?.message || err));
      direction = { environment: "", camera: "", sound: "" };
      rawMusic = [];
    }
  } else {
    // No screenplay (a Film from before the Script stage): the whole film in one call, as before.
    const answer = await model.json({
      messages: storyFlowShotlistMessages({ idea, world, durations, screenplay, language, engine: job.engine }),
      maxTokens: 24000,
      temperature: 0.7,
    });
    ({ segments, direction } = parseSegments(answer, world, durations));
    rawMusic = answer?.music;
  }

  const shots = segmentShots(segments);
  const saved = await (deps.saveShotlist || saveShotlist)(env, pid, { shots, mode: "replace", source: "auto" });
  if (saved?.error) throw new Error(saved.error);

  // The score's pacing, on the shots as saved — what the Score stage lays on
  // the measured film (film-stages/score.js).
  const music = repairMusicCues(rawMusic, { durs: shots.map((s) => s.dur), plannedSec: plan.seconds });
  const cues = music.length ? ` · ${music.length} music cue${music.length === 1 ? "" : "s"}` : "";
  const count = segments.reduce((a, s) => a + s.stages.length, 0);
  const open = checks.filter((c) => c.issues?.length).length;
  return {
    summary: `${segments.length} segment${segments.length === 1 ? "" : "s"} (${durations.join("s, ")}s) · ${count} shots · ${plan.length}${cues}${open ? ` · ${open} segment${open === 1 ? "" : "s"} with notes` : ""}`,
    result: {
      seconds: plan.seconds,
      durations,
      direction,
      segments,
      ...(draft?.id ? { draftId: draft.id, draftName: draft.name || null } : {}),
      ...(checks.length ? { checks } : {}),
      ...(music.length ? { music } : {}),
      ...(saved?.warnings?.length ? { warnings: saved.warnings } : {}),
    },
  };
}
