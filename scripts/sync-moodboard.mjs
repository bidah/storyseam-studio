// Vendor the moodboard op reducer into the Worker.
//
//   src/lib/moodboard-document.js  →  worker/src/lib/moodboard-document.js
//
// Run after editing the canonical file:  npm run moodboard:sync
//
// The reducer runs on BOTH sides on purpose. The client applies each op
// optimistically so a drag or a keystroke paints without a round-trip; the
// Worker re-applies the same op inside `updateDoc`'s compare-and-swap so
// concurrent writers can't clobber each other. Two implementations of that would
// diverge the moment one of them grew a special case — and the divergence would
// be silent, showing up as cards that jump back after a reload.
//
// Why copy instead of import: wrangler bundles the worker from `worker/` and
// won't resolve a path outside it — the same constraint that already forces
// `shared/schemas/*.json`, `src/lib/routeTable.js` and `src/editor/*` to be
// vendored. The reducer is deliberately import-free and DOM-free precisely so a
// straight copy is enough. `npm run guards` fails when the copy drifts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src/lib/moodboard-document.js");
const TARGET = path.join(ROOT, "worker/src/lib/moodboard-document.js");

const BANNER =
  "// VENDORED from src/lib/moodboard-document.js — DO NOT EDIT HERE.\n" +
  "// Edit the canonical file, then run `npm run moodboard:sync`\n" +
  "// (scripts/sync-moodboard.mjs).\n";

if (!fs.existsSync(SOURCE)) throw new Error(`missing canonical source: ${SOURCE}`);

const next = BANNER + "\n" + fs.readFileSync(SOURCE, "utf8");
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : null;
if (current === next) {
  console.log("moodboard: worker copy already up to date.");
} else {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, next);
  console.log(`moodboard: moodboard-document.js → ${path.relative(ROOT, TARGET)}`);
}
