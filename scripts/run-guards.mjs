/**
 * Run every guard in scripts/guards/ and report what fired.
 *
 * Guards mechanise the rules in CLAUDE.md that fail SILENTLY — a vendored copy
 * left stale, an /api route the agent can't reach, a mutation that quietly drops
 * concurrent edits. None of those break a build or a test; all of them are
 * cheap to catch statically.
 *
 *   npm run guards
 *
 * Every guard runs even after one fails, so a single violation never hides the
 * rest. Exit code is 1 if anything fired.
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const GUARD_DIR = join(dirname(fileURLToPath(import.meta.url)), "guards");

const guards = [];
for (const file of readdirSync(GUARD_DIR).sort()) {
  if (!file.endsWith(".mjs") || file === "lib.mjs") continue;
  guards.push(await import(pathToFileURL(join(GUARD_DIR, file)).href));
}

let failed = 0;
for (const guard of guards) {
  let violations;
  try {
    violations = guard.run() ?? [];
  } catch (err) {
    // A guard that throws is itself a failure — never a silent pass.
    console.error(`✗ ${guard.name} — the guard itself threw: ${err?.message || err}`);
    failed++;
    continue;
  }
  if (!violations.length) {
    console.log(`✓ ${guard.name} — ${guard.describe}`);
    continue;
  }
  failed++;
  console.error(`✗ ${guard.name} — ${guard.describe}`);
  for (const v of violations) console.error(`    ${v}`);
}

if (failed) {
  console.error(`\n${failed} guard${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log(`\nAll ${guards.length} guards passed.`);
