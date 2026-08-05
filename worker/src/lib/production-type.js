// The project's PRODUCTION TYPE — what kind of film this is, chosen once on the
// World tab and read by everything downstream.
//
// It exists because the Seedance prompt for a live-action shot is not a longer
// version of the 2D one, it is a different document. A 2D/3D-Pixar shot gets one
// vivid paragraph and leans on the Episode tab's style preset; a live-action shot
// gets the block structure of the `shot-list-live-action` skill (SCENE CONTEXT,
// ACTIVE REFERENCES, … POSITIVE LOCKS), where style is DISTRIBUTED into the block
// that governs it and nothing style-related opens the prompt. So the production
// type picks which shot-list skill the agent runs, which prompt editor the Shot
// list tab renders, and where routes/episode.js is allowed to inject the style.
//
// `2d` is the default and what every pre-existing project is: an absent field
// must keep behaving exactly as it did before this existed.

import shotlistSchema from "../schemas/shotlist.json";

export const PRODUCTION_TYPES = [
  { id: "2d", label: "2D animation", short: "2D" },
  { id: "3d-pixar", label: "3D (Pixar-like)", short: "3D Pixar" },
  { id: "live-action", label: "Live action", short: "Live action" },
];

export const PRODUCTION_TYPE_IDS = PRODUCTION_TYPES.map((p) => p.id);

export const DEFAULT_PRODUCTION_TYPE = "2d";

// Anything unrecognised — absent, empty, a typo, an old doc — reads as 2D.
export const normalizeProductionType = (v) =>
  PRODUCTION_TYPE_IDS.includes(String(v || "")) ? String(v) : DEFAULT_PRODUCTION_TYPE;

export const isLiveAction = (v) => normalizeProductionType(v) === "live-action";

// The live-action prompt blocks, IN ORDER, derived from the shared capability
// contract rather than re-listed here. `shared/schemas/shotlist.json` already has
// to describe them (the route validates them and the agent's save_shotlist tool
// builds its input from them), so re-typing the list in this file is exactly the
// drift `npm run guards` exists to catch. JSON preserves key order, and each
// field carries the `label` that becomes the block's heading line in the prompt.
const BLOCK_FIELDS = shotlistSchema.input.fields.shots.items.fields.promptBlocks.fields;

export const PROMPT_BLOCKS = Object.entries(BLOCK_FIELDS).map(([key, field]) => ({
  key,
  label: field.label,
  description: field.description,
}));

export const PROMPT_BLOCK_KEYS = PROMPT_BLOCKS.map((b) => b.key);

// Coerce an incoming blocks object to the canonical shape: known keys only, in
// canonical order, strings only. Returns null when nothing survives, so a shot
// with no blocks stores no empty object.
export function normalizePromptBlocks(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const { key } of PROMPT_BLOCKS) {
    const text = raw[key] == null ? "" : String(raw[key]);
    if (text.trim()) out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

// Render the blocks into the single `prompt` string the renderer reads
// (worker/src/lib/pack.js splices it into each bundle's skillPrompt). Empty
// blocks are dropped rather than emitted as a bare heading — a heading with
// nothing under it reads to the model as an instruction to invent one.
export function composePromptBlocks(blocks) {
  const norm = normalizePromptBlocks(blocks);
  if (!norm) return "";
  return PROMPT_BLOCKS
    .filter((b) => norm[b.key])
    .map((b) => `${b.label}\n${norm[b.key].trim()}`)
    .join("\n\n");
}
