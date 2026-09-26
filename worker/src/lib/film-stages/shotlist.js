// The Film job's "Shot list" stage (Auto, PRD #59 / #66).
//
// The writing model cuts the Film — the Idea and the World, at the Film plan's
// length — into shots, using the shot-list playbook's own rules for how a shot
// is cut and what every field holds (SHOTLIST_FIELDS, vendored by
// `npm run auto:sync`, so the chat agent and this job write the same list).
// What differs is the job: there is no signed screenplay to walk and nobody to
// ask, so the Idea and the World ARE the story, and the whole list comes back
// in one answer rather than one beat per tool call.
//
// Saved through `saveShotlist` — the same helper POST /api/shotlist and the
// agent's save_shotlist use — as a `replace`, so stored shot ids are preserved
// by content and names are pulled to the World roster exactly as they are for
// every other writer. The job never mints or renumbers ids itself.
//
// ── The music cue layer ────────────────────────────────────────────────────
// The same answer carries the score's pacing: a top-level `music` list of cues
// from ONE fixed vocabulary (MUSIC_CUES in src/lib/music-cues.ts — suspense,
// dread, adventure, action, party, wonder, whimsy, tender, triumph, sad,
// silence), each starting at a shot (1-based) and running until the next.
// Written HERE, by the model deciding where the story turns, the music turns
// with the story — the Score stage no longer has to guess sections from the
// finished film. Pure code repairs the layer (`repairMusicCues`) and it rides
// in this stage's RESULT (`result.music`, by shot index, planned second and
// shot id), never in a document: it is the Film job's own intermediate state.
// Shot ids are minted by saveShotlist and not returned by a replace, so they
// are read back from the saved list. No music in the answer is no cues — the
// stage still succeeds and the Score stage scores the old way.
import { SHOTLIST_FIELDS } from "../auto-prompts.generated.js";
import { planFilm, formatLength } from "../film-plan.ts";
import { readWorld } from "../../routes/world.js";
import { saveShotlist } from "../../routes/shotlist.js";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { MUSIC_CUES, MUSIC_CUE_NAMES, musicCueRange, repairMusicCues } from "../music-cues.ts";
import { readDoc } from "../docs.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** The Film's length: what the plan quoted for this prompt (or an explicit `job.seconds`). */
export const filmPlanFor = (job) => planFilm({ prompt: job.prompt, seconds: job.seconds ?? null });

export function shotlistMessages({ idea, world, seconds, language = DEFAULT_FILM_LANGUAGE }) {
  const cast = (world.characters || []).map((c) => `- ${c.name}${c.role ? ` — ${c.role}` : ""}`).join("\n");
  const places = (world.locations || [])
    .map((l) => `- ${l.slug || l.name} (${l.name})${l.description ? `: ${l.description}` : ""}`)
    .join("\n");
  const approx = Math.round(seconds / 4);
  const [lo, hi] = musicCueRange(seconds);
  const system = [
    "You are the writing room of StorySeam's Auto pipeline, cutting a short film into its SHOT LIST.",
    "There is no screenplay and nobody to ask: the Idea and the World below ARE the story. Tell it",
    `completely — a beginning, a turn, an ending — in exactly ${formatLength(seconds)} (${seconds} seconds) of`,
    `film: the shots' \`dur\` must add up to ${seconds}. Aim for about ${approx} shots of 2–6 seconds each.`,
    "",
    "How a shot is cut and what every field holds, as the studio's shot-list playbook states it:",
    "",
    SHOTLIST_FIELDS,
    "",
    "For this list:",
    "- There is no script, so beats are the story's own movements (B1, B2, …) — one per place/scene.",
    "- `location` is one of the World's place SLUGS listed below.",
    "- `characters` uses the World's names EXACTLY.",
    "- `action` names every character in the shot by that exact name (never \"he\" or \"the pilot\"): the",
    "  studio finds each character's model sheet by their name in the text.",
    `- \`dialogue\` is written in ${language}, and only ${language}.`,
    "- `audioSync` is sound effects and foley only — never music (the score is laid under the film later).",
    "- `prompt` is ONE vivid, style-free paragraph (at most ~60 words) describing what the camera sees.",
    "- Do not include `id` — the studio keeps shot ids itself.",
    "",
    "THE MUSIC. Beside the shots, write where the score turns — a list of music cues. Each cue starts",
    "at a shot (`startShot`, the 1-based position of the shot in your `shots` list) and runs until the",
    "next cue. `cue` is EXACTLY one of these names and nothing else:",
    ...MUSIC_CUE_NAMES.map((n) => `  ${n}${MUSIC_CUES[n].family === "none" ? " — no music at all" : ` (${MUSIC_CUES[n].family})`}`),
    `- ${lo}–${hi} cues for this film. The FIRST cue starts at shot 1.`,
    "- Change the cue ONLY where the story TURNS (a discovery, a threat, a chase begins, a loss, a win) —",
    "  never at every new shot. Each cue lasts at least ~8 seconds of film.",
    "- `silence` is the score stopping on purpose: a held breath before a big action, a heavy exchange",
    "  of dialogue, a reveal. Use 2–3 per film, 4–15 seconds each, and never as the first or the last cue.",
    "- `energy` is 1 (barely there) to 5 (everything); `note` is a few words on why the music turns here.",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "shots": [{ "beat", "beatTitle", "location", "dur": number, "characters": [string],',
    '  "camera", "action", "dialogue", "audioSync", "prompt" }],',
    '  "music": [{ "startShot": number, "cue": string, "energy": number, "note": string }] }',
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
    "Places (slug (name): description):",
    places || "(none)",
  ].filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The model's answer → the shots to save (fields only; no ids). Throws on none. */
export function parseShots(answer) {
  const raw = Array.isArray(answer?.shots) ? answer.shots : Array.isArray(answer) ? answer : [];
  const shots = raw
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      beat: str(s.beat),
      beatTitle: str(s.beatTitle),
      location: str(s.location),
      dur: Math.max(0, Number(s.dur) || 0),
      characters: (Array.isArray(s.characters) ? s.characters : s.characters ? [s.characters] : []).map(str).filter(Boolean),
      camera: str(s.camera),
      action: str(s.action),
      dialogue: str(s.dialogue),
      audioSync: str(s.audioSync),
      prompt: str(s.prompt),
    }))
    .filter((s) => s.action || s.prompt);
  if (!shots.length) throw new Error("The writing model returned no shots.");
  return shots;
}

/**
 * The saved shots' ids, by index — only when the stored list is the one just
 * saved (same length). Never throws: a cue without a shot id still has its
 * index and its planned second.
 */
async function savedShotIds(env, pid, count) {
  try {
    const shots = (await readDoc(env, pid, "shotlist", { shots: [] })).shots || [];
    return shots.length === count ? shots.map((s) => (s?.id == null ? undefined : String(s.id))) : [];
  } catch {
    return [];
  }
}

/** deps (optional): { readWorld, saveShotlist, shotIds }. */
export async function runShotlistStage({ job, results, env, model }, deps = {}) {
  const pid = job.projectId;
  const world = await (deps.readWorld || readWorld)(env, pid);
  const { seconds } = filmPlanFor(job);
  const idea = results?.world?.idea || "";

  const answer = await model.json({
    messages: shotlistMessages({ idea, world, seconds, language: job.language || DEFAULT_FILM_LANGUAGE }),
    maxTokens: 32000,
    temperature: 0.7,
  });
  const shots = parseShots(answer);

  const saved = await (deps.saveShotlist || saveShotlist)(env, pid, { shots, mode: "replace", source: "auto" });
  if (saved?.error) throw new Error(saved.error);
  const count = saved?.count ?? shots.length;
  const shotSeconds = Math.round(shots.reduce((sum, s) => sum + s.dur, 0));
  const music = repairMusicCues(answer?.music, {
    durs: shots.map((s) => s.dur),
    plannedSec: seconds,
    ids: await (deps.shotIds || savedShotIds)(env, pid, shots.length),
  });
  const cues = music.length ? ` · ${music.length} music cue${music.length === 1 ? "" : "s"}` : "";
  return {
    summary: `${count} shot${count === 1 ? "" : "s"}, ${formatLength(shotSeconds)} as written${cues}`,
    result: {
      count,
      seconds: shotSeconds,
      ...(music.length ? { music } : {}),
      ...(saved?.warnings?.length ? { warnings: saved.warnings } : {}),
    },
  };
}
