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
import { SHOTLIST_FIELDS } from "../auto-prompts.generated.js";
import { planFilm, formatLength } from "../film-plan.ts";
import { readWorld } from "../../routes/world.js";
import { saveShotlist } from "../../routes/shotlist.js";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** The Film's length: what the plan quoted for this prompt (or an explicit `job.seconds`). */
export const filmPlanFor = (job) => planFilm({ prompt: job.prompt, seconds: job.seconds ?? null });

export function shotlistMessages({ idea, world, seconds, language = DEFAULT_FILM_LANGUAGE }) {
  const cast = (world.characters || []).map((c) => `- ${c.name}${c.role ? ` — ${c.role}` : ""}`).join("\n");
  const places = (world.locations || [])
    .map((l) => `- ${l.slug || l.name} (${l.name})${l.description ? `: ${l.description}` : ""}`)
    .join("\n");
  const approx = Math.round(seconds / 4);
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
    "Answer with ONE JSON object and nothing else:",
    '{ "shots": [{ "beat", "beatTitle", "location", "dur": number, "characters": [string],',
    '  "camera", "action", "dialogue", "audioSync", "prompt" }] }',
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

/** deps (optional): { readWorld, saveShotlist }. */
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
  return {
    summary: `${count} shot${count === 1 ? "" : "s"}, ${formatLength(shotSeconds)} as written`,
    result: { count, seconds: shotSeconds, ...(saved?.warnings?.length ? { warnings: saved.warnings } : {}) },
  };
}
