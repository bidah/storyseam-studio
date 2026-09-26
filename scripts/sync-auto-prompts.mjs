/**
 * Vendor the writing-step prompts an Auto Film's Worker job needs out of the
 * agent's skill playbooks, so each is written ONCE.
 *
 *   flue-agent/src/skills/world-creation/SKILL.md  (## The shape of the world)
 *     →  worker/src/lib/auto-prompts.generated.js  (WORLD_SHAPE)
 *   flue-agent/src/skills/shot-list/SKILL.md       (steps 2–3: cutting + fields)
 *     →  worker/src/lib/auto-prompts.generated.js  (SHOTLIST_FIELDS)
 *   flue-agent/src/skills/model-sheets/SKILL.md    (## The form … ## To state SIZE)
 *     →  worker/src/lib/auto-prompts.generated.js  (SHEET_FORM)
 *
 * Run after editing the playbook:  npm run auto:sync
 *
 * WHY A SECTION AND NOT THE WHOLE FILE. The playbook is an interview script for
 * the chat agent — "never invent a world from a one-line premise", "STOP after
 * each card" — which is the opposite of what Auto does (the prompt IS the brief;
 * nothing asks). What both paths must agree on is the SHAPE of the World they
 * write: the map's five questions, the depth's five elements, a character's
 * type breakdown. That section is lifted verbatim; the Auto-only instructions
 * live beside the job (worker/src/lib/film-job.js).
 *
 * The Worker can't read a .md at runtime (wrangler has no Text rule for it, and
 * the Vitest worker project runs in plain node), so it gets a JS string module.
 * `npm run guards` (vendored-in-sync) fails when the copy drifts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const AUTO_PROMPTS_SOURCE = "flue-agent/src/skills/world-creation/SKILL.md";
export const SHOTLIST_PROMPTS_SOURCE = "flue-agent/src/skills/shot-list/SKILL.md";
export const SHEET_PROMPTS_SOURCE = "flue-agent/src/skills/model-sheets/SKILL.md";
export const AUTO_PROMPTS_TARGET = "worker/src/lib/auto-prompts.generated.js";

const START = "## The shape of the world";
const END = "## How to run the interview";

// The shot-list playbook's "how to cut shots and what every field holds" —
// steps 2 and 3. Step 4 onward is about saving one beat per tool call, which is
// the chat agent's problem (its output cap), not the job's.
const SHOTLIST_START = "2. Walk the screenplay";
const SHOTLIST_END = "4. **Save the list";

// What a model sheet looks like and how its prompt is written — the form, the
// shared render clause, the negatives, the scale trick. "How to actually make
// one here" is the chat agent's tool sequence; the job has its own.
const SHEET_START = "## The form";
const SHEET_END = "## How to actually make one here";

function section(file, start, end) {
  const md = fs.readFileSync(path.join(ROOT, file), "utf8");
  const a = md.indexOf(start);
  const b = md.indexOf(end);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(`${file}: can't find "${start}" … "${end}" — the sync's anchors are stale`);
  }
  return md.slice(a, b).trim();
}

/** The generated module's full text, from the playbooks on disk. */
export function renderAutoPrompts() {
  const shape = section(AUTO_PROMPTS_SOURCE, START, END);
  const shotFields = section(SHOTLIST_PROMPTS_SOURCE, SHOTLIST_START, SHOTLIST_END);
  const sheetForm = section(SHEET_PROMPTS_SOURCE, SHEET_START, SHEET_END);
  return (
    `// GENERATED from ${AUTO_PROMPTS_SOURCE},\n` +
    `// ${SHOTLIST_PROMPTS_SOURCE} and ${SHEET_PROMPTS_SOURCE} — DO NOT EDIT HERE.\n` +
    "// Edit the playbooks, then run `npm run auto:sync` (scripts/sync-auto-prompts.mjs).\n" +
    "\n" +
    "// The World's shape as the world-creation playbook states it — the part the\n" +
    "// chat agent and the Auto Film job must agree on.\n" +
    `export const WORLD_SHAPE = ${JSON.stringify(shape)};\n` +
    "\n" +
    "// How the shot-list playbook cuts a story into shots and fills each one —\n" +
    "// the part the chat agent and the Auto Film job must agree on.\n" +
    `export const SHOTLIST_FIELDS = ${JSON.stringify(shotFields)};\n` +
    "\n" +
    "// How the model-sheets playbook says a reference sheet is drawn and prompted.\n" +
    `export const SHEET_FORM = ${JSON.stringify(sheetForm)};\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = path.join(ROOT, AUTO_PROMPTS_TARGET);
  fs.writeFileSync(out, renderAutoPrompts());
  console.log(`auto:sync → ${AUTO_PROMPTS_TARGET}`);
}
