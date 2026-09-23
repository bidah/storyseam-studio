/**
 * Vendor the plugin catalog into the two packages that can't import across the
 * repo root.
 *
 *   src/lib/plugins.ts  →  worker/src/lib/plugins.ts
 *                       →  flue-agent/src/lib/plugins.ts
 *
 * Run after editing the canonical file:  npm run plugins:sync
 *
 * The catalog is the contract three surfaces agree on: which tabs the header
 * draws, which routes the Worker will accept an install for, and which tools the
 * agent must refuse to run because their plugin isn't installed. A drifted copy
 * means an agent that offers to install a plugin the marketplace has never heard
 * of — so `npm run guards` fails when one drifts.
 *
 * Why copy instead of import: wrangler bundles the worker from `worker/` and
 * Vite bundles the agent from `flue-agent/`; neither resolves a path outside its
 * own root. The catalog is deliberately import-free and pure data precisely so a
 * straight copy is enough — the same arrangement as `specialists.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src/lib/plugins.ts");
const TARGETS = [
  path.join(ROOT, "worker/src/lib/plugins.ts"),
  path.join(ROOT, "flue-agent/src/lib/plugins.ts"),
];

const BANNER =
  "// VENDORED from src/lib/plugins.ts — DO NOT EDIT HERE.\n" +
  "// Edit the canonical file, then run `npm run plugins:sync`\n" +
  "// (scripts/sync-plugins.mjs).\n";

if (!fs.existsSync(SOURCE)) throw new Error(`missing canonical source: ${SOURCE}`);

const body = fs.readFileSync(SOURCE, "utf8");
if (/^\s*import\s/m.test(body)) {
  throw new Error(
    "src/lib/plugins.ts must stay import-free — it is vendored verbatim into two packages " +
      "that cannot resolve this repo's module graph.",
  );
}

const next = BANNER + "\n" + body;
for (const target of TARGETS) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (current === next) {
    console.log(`plugins: ${path.relative(ROOT, target)} already up to date.`);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, next);
  console.log(`plugins: plugins.ts → ${path.relative(ROOT, target)}`);
}
