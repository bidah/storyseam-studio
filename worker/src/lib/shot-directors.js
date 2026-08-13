// SHOT DIRECTORS — the author-editable prompt system a shot is written with.
//
// The project's PRODUCTION TYPE (world.productionType: 2d / 3d-pixar /
// live-action) says what kind of film this is. A DIRECTOR says how a shot's
// render prompt is written for it: the brief the shot-list skills follow, and
// the FORM the prompt takes (`paragraph` -> `prompt`, `blocks` ->
// `promptBlocks`). Each production type has one director in use; the author
// picks it, edits its text, and saves new versions on the Settings page, and the
// agent reads the active one back with `get_shot_director`.
//
// Built-ins are NOT stored in the document — they are seeded from
// `shot-director-seeds.js` on every read, so an improved seed reaches every
// existing project. Editing a built-in stores an OVERRIDE entry under the same
// id (the seed text stays available as "reset to the built-in"), and "save as a
// new version" stores a brand-new entry with its own id.
//
// The doc (`shot-directors`):
//   { directors: [ { id, name, productionType, promptForm, instructions,
//                    basedOn, version, createdAt, updatedAt } ],
//     active:   { "2d": id, "3d-pixar": id, "live-action": id } }
import { readDoc } from "./docs.js";
import { SEED_DIRECTORS } from "./shot-director-seeds.js";
import { PRODUCTION_TYPE_IDS, normalizeProductionType } from "./production-type.js";

export const PROMPT_FORMS = ["paragraph", "blocks"];

// The form a director writes in. Anything unrecognised reads as "paragraph" —
// the pre-existing default for every non-live-action project.
export const normalizePromptForm = (v) =>
  PROMPT_FORMS.includes(String(v || "")) ? String(v) : "paragraph";

// The built-in director that seeds a production type (never null: 2d's seed is
// the ultimate fallback).
const seedFor = (pt) =>
  SEED_DIRECTORS.find((d) => d.productionType === normalizeProductionType(pt)) ||
  SEED_DIRECTORS[0];

const isSeedId = (id) => SEED_DIRECTORS.some((d) => d.id === id);

const str = (v) => (v == null ? "" : String(v));

// One director as the API serves it: the seed, with any stored override applied
// on top, plus the flags the UI needs to render "built-in / edited / custom".
function hydrate(stored) {
  const seed = SEED_DIRECTORS.find((d) => d.id === stored?.id);
  if (!seed) {
    return {
      id: str(stored.id),
      name: str(stored.name) || "Untitled director",
      productionType: normalizeProductionType(stored.productionType),
      promptForm: normalizePromptForm(stored.promptForm),
      instructions: str(stored.instructions),
      blurb: str(stored.blurb),
      builtin: false,
      edited: false,
      basedOn: stored.basedOn ? str(stored.basedOn) : null,
      version: Number(stored.version) || 1,
      createdAt: stored.createdAt || null,
      updatedAt: stored.updatedAt || null,
    };
  }
  return {
    ...seed,
    name: str(stored.name) || seed.name,
    productionType: normalizeProductionType(stored.productionType || seed.productionType),
    promptForm: normalizePromptForm(stored.promptForm || seed.promptForm),
    instructions: str(stored.instructions) || seed.instructions,
    builtin: true,
    // An override that still matches the seed text isn't really an edit.
    edited: !!str(stored.instructions) && str(stored.instructions) !== seed.instructions,
    basedOn: null,
    version: Number(stored.version) || 1,
    createdAt: stored.createdAt || null,
    updatedAt: stored.updatedAt || null,
  };
}

// Every director available to this project: the built-ins (overridden where the
// author edited one) followed by the author's own versions, oldest first.
export function listDirectors(doc) {
  const stored = Array.isArray(doc?.directors) ? doc.directors.filter((d) => d && d.id) : [];
  const byId = new Map(stored.map((d) => [str(d.id), d]));
  const builtins = SEED_DIRECTORS.map((seed) =>
    byId.has(seed.id) ? hydrate(byId.get(seed.id)) : { ...seed, builtin: true, edited: false, basedOn: null, version: 1, createdAt: null, updatedAt: null },
  );
  const custom = stored.filter((d) => !isSeedId(str(d.id))).map(hydrate);
  return [...builtins, ...custom];
}

// The active director id per production type, with every type resolved to a real
// director (a stored id that no longer exists falls back to that type's seed).
export function activeMap(doc, directors = listDirectors(doc)) {
  const byId = new Map(directors.map((d) => [d.id, d]));
  const out = {};
  for (const pt of PRODUCTION_TYPE_IDS) {
    const picked = str(doc?.active?.[pt]);
    out[pt] = picked && byId.has(picked) ? picked : seedFor(pt).id;
  }
  return out;
}

// The director this project writes shots with RIGHT NOW — the one active for the
// world bible's production type. Everything that used to branch on
// `isLiveAction(productionType)` reads `promptForm` off this instead.
export async function resolveActiveDirector(env, pid, productionTypeHint) {
  let productionType = productionTypeHint;
  if (productionType === undefined) {
    const world = await readDoc(env, pid, "world", null);
    productionType = world?.productionType;
  }
  productionType = normalizeProductionType(productionType);
  const doc = await readDoc(env, pid, "shot-directors", null);
  const directors = listDirectors(doc);
  const id = activeMap(doc, directors)[productionType];
  const director = directors.find((d) => d.id === id) || directors[0];
  return { productionType, director };
}

// The compact form the shot list / agent responses carry: enough to know which
// prompt form to write and which director wrote it, without shipping the whole
// instruction text on every read.
export const directorSummary = (director) => ({
  id: director.id,
  name: director.name,
  promptForm: director.promptForm,
  builtin: !!director.builtin,
});

// The stored shape of a director (what actually lands in the doc). Built-in
// overrides keep the seed id; a new version gets a fresh one.
export function toStored(director, now) {
  return {
    id: director.id,
    name: director.name,
    productionType: director.productionType,
    promptForm: director.promptForm,
    instructions: director.instructions,
    ...(director.basedOn ? { basedOn: director.basedOn } : {}),
    version: director.version,
    createdAt: director.createdAt || now,
    updatedAt: now,
  };
}

export { SEED_DIRECTORS, seedFor, isSeedId };
