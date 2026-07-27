// Copy the empty-chat suggestion deck from the web app (../src/lib/suggestions.ts)
// into this app's src/lib/, so both surfaces offer the same cards with the same
// composed prompts. Run after editing the web file:
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
const DST = path.resolve(__dirname, "..", "src", "lib", "suggestions.ts");

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
const current = fs.existsSync(DST) ? fs.readFileSync(DST, "utf8") : null;
if (current === next) {
  console.log("[sync] suggestions.ts already up to date.");
  process.exit(0);
}
fs.writeFileSync(DST, next);
console.log("[sync] suggestions.ts → src/lib/suggestions.ts");
