// Client-side view of the project's PRODUCTION TYPE — see
// `worker/src/lib/production-type.js` for what it is and why it lives on the
// world bible. This module is the front-end's copy of the two things the UI
// needs: the pickable types, and the live-action prompt blocks.
//
// The block list is NOT re-typed here. It is derived from
// `shared/schemas/shotlist.json` — the same canonical contract the worker
// validates against and the agent's `save_shotlist` builds its input from — so
// the Shot list tab can never render a block set the route would reject. JSON
// preserves key order, so the schema's field order IS the prompt's block order.
import shotlistSchema from "../../shared/schemas/shotlist.json";

export const PRODUCTION_TYPES = [
  { id: "2d", label: "2D animation", short: "2D" },
  { id: "3d-pixar", label: "3D (Pixar-like)", short: "3D Pixar" },
  { id: "live-action", label: "Live action", short: "Live action" },
];

export const DEFAULT_PRODUCTION_TYPE = "2d";

export const normalizeProductionType = (v) =>
  PRODUCTION_TYPES.some((p) => p.id === v) ? v : DEFAULT_PRODUCTION_TYPE;

export const productionTypeMeta = (v) =>
  PRODUCTION_TYPES.find((p) => p.id === normalizeProductionType(v));

export const isLiveAction = (v) => normalizeProductionType(v) === "live-action";

// The live-action prompt blocks, in order: `{ key, label, description }`. The
// description is the guidance the agent's tool schema carries for that block —
// showing the author the same brief the model works from.
export const PROMPT_BLOCKS = Object.entries(
  shotlistSchema.input.fields.shots.items.fields.promptBlocks.fields,
).map(([key, field]) => ({ key, label: field.label, description: field.description }));

// Mirror of the worker's `composePromptBlocks` — used only to PREVIEW the
// composed prompt on the tab. The stored value is always the server's.
export const composePromptBlocks = (blocks) =>
  PROMPT_BLOCKS
    .filter((b) => String(blocks?.[b.key] || "").trim())
    .map((b) => `${b.label}\n${String(blocks[b.key]).trim()}`)
    .join("\n\n");
