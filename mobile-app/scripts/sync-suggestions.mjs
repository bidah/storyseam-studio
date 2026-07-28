// Copy the suggestion deck from the web app (../src/lib/suggestions.ts) to the
// two places that also need it, so every surface offers the same cards with the
// same composed prompts:
//
//   · this app's src/lib/          — the mobile Chat tab's cards
//   · ../worker/src/lib/           — the DETERMINISTIC FLOOR under
//     POST /api/next-questions, the follow-ups shown after a finished turn.
//     That route generates its four suggestions with a small model, and falls
//     back to this deck whenever generation fails or comes back short — so the
//     worker needs the same pure function, not a second implementation of it.
//
// Run after editing the web file:
//
//   npm --prefix mobile-app run sync:suggestions
//
// Why vendor instead of importing across the two apps? Metro resolves modules
// from the mobile project root and the two packages have separate tsconfigs and
// dependency trees, so `../../src/lib/suggestions` isn't reachable at bundle
// time. The deck is deliberately import-free and pure (no React, no fetching, no
// platform APIs) precisely so a straight copy is enough — same trade the Remotion
// composition makes in render-fn/scripts/sync-composition.mjs and the route table
// makes in desktop/.
//
// The failure mode this guards against is silent: edit the web deck, forget to
// sync, and the phone keeps offering last week's cards with no error anywhere.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "..", "src", "lib", "suggestions.ts");
const DSTS = [
  ["mobile", path.resolve(__dirname, "..", "src", "lib", "suggestions.ts")],
  ["worker", path.resolve(__dirname, "..", "..", "worker", "src", "lib", "suggestions.ts")],
];

const BANNER =
  "// VENDORED from shot-studio/src/lib/suggestions.ts — DO NOT EDIT HERE.\n" +
  "// Edit the web copy, then run `npm --prefix mobile-app run sync:suggestions`\n" +
  "// (scripts/sync-suggestions.mjs).\n";

if (!fs.existsSync(SRC)) {
  console.error(`[sync] source not found: ${SRC}`);
  console.error("[sync] run this from inside the shot-studio repo (needs ../src/lib).");
  process.exit(1);
}

const original = fs.readFileSync(SRC, "utf8");
const next = BANNER + "\n" + original;
let wrote = 0;
for (const [name, dst] of DSTS) {
  const current = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : null;
  if (current === next) {
    console.log(`[sync] ${name}: already up to date.`);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, next);
  console.log(`[sync] ${name}: suggestions.ts → ${path.relative(path.resolve(__dirname, "..", ".."), dst)}`);
  wrote += 1;
}
if (!wrote) process.exit(0);
