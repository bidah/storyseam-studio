/**
 * Fan the shared capability contracts out to the two packages that consume them.
 *
 * `shared/schemas/*.json` is CANONICAL. It is copied verbatim to:
 *   1. `worker/src/schemas/`      — the route validates incoming bodies with it
 *                                   (worker/src/lib/validate.js)
 *   2. `flue-agent/src/schemas/`  — the tool builds its valibot input from it
 *                                   (flue-agent/src/lib/schema-to-valibot.ts)
 *
 * Run after any contract edit:  npm run schemas:sync
 *
 * Why copy instead of import across packages: each package is bundled from its
 * own root (wrangler for the worker, flue for the agent) and neither resolves a
 * path outside it. Same call `render-fn`, `mobile-app/src/genui` and
 * `desktop/main/routeTable.js` already make — and, like those, `npm run guards`
 * fails when a copy drifts, so skipping the sync can't go unnoticed.
 *
 * The copies are byte-identical: JSON can't carry a "generated, do not edit"
 * banner, so the guard compares them verbatim and this file writes them verbatim.
 * The README in shared/schemas/ is where that warning lives instead.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "shared/schemas");
const TARGETS = [join(ROOT, "worker/src/schemas"), join(ROOT, "flue-agent/src/schemas")];

const files = (await readdir(SOURCE)).filter((f) => f.endsWith(".json"));
if (!files.length) throw new Error(`no schemas found in ${SOURCE}`);

for (const target of TARGETS) await mkdir(target, { recursive: true });

for (const file of files) {
  const text = await readFile(join(SOURCE, file), "utf8");
  // Parse before writing: a malformed contract shipped to both packages fails at
  // bundle time in two places with two confusing errors, instead of here with one.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`shared/schemas/${file} is not valid JSON: ${err.message}`);
  }
  for (const field of ["capability", "route", "tool", "description", "input"]) {
    if (!parsed[field]) throw new Error(`shared/schemas/${file} is missing "${field}"`);
  }
  for (const target of TARGETS) await writeFile(join(target, file), text);
  console.log(`schemas: ${file} → ${TARGETS.length} packages  (${parsed.capability})`);
}
