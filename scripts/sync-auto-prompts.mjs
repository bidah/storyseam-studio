/**
 * Vendor the writing-step prompts an Auto Film's Worker job needs out of the
 * agent's skill playbooks, so each is written ONCE.
 *
 *   flue-agent/src/skills/world-creation/SKILL.md  (## The shape of the world)
 *     →  worker/src/lib/auto-prompts.generated.js  (WORLD_SHAPE)
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
export const AUTO_PROMPTS_TARGET = "worker/src/lib/auto-prompts.generated.js";

const START = "## The shape of the world";
const END = "## How to run the interview";

/** The generated module's full text, from the playbook on disk. */
export function renderAutoPrompts() {
  const md = fs.readFileSync(path.join(ROOT, AUTO_PROMPTS_SOURCE), "utf8");
  const a = md.indexOf(START);
  const b = md.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(`${AUTO_PROMPTS_SOURCE}: can't find "${START}" … "${END}" — the sync's anchors are stale`);
  }
  const section = md.slice(a, b).trim();
  return (
    `// GENERATED from ${AUTO_PROMPTS_SOURCE} — DO NOT EDIT HERE.\n` +
    "// Edit the playbook, then run `npm run auto:sync` (scripts/sync-auto-prompts.mjs).\n" +
    "\n" +
    "// The World's shape as the world-creation playbook states it — the part the\n" +
    "// chat agent and the Auto Film job must agree on.\n" +
    `export const WORLD_SHAPE = ${JSON.stringify(section)};\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = path.join(ROOT, AUTO_PROMPTS_TARGET);
  fs.writeFileSync(out, renderAutoPrompts());
  console.log(`auto:sync → ${AUTO_PROMPTS_TARGET}`);
}
