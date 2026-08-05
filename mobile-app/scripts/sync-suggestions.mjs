// Copy the suggestion deck from the web app to the places that also need it, so
// every surface offers the same cards, with the same composed prompts and the
// same artwork. TWO files travel:
//
//   · suggestions.ts — the deck itself. Vendored into:
//       · this app's src/lib/    — the mobile Chat tab's cards
//       · ../worker/src/lib/     — where POST /api/suggestions/reconcile runs
//         `openGapIds` to decide which started cards the pipeline has since
//         finished. That sweep MUST agree with what the surfaces showed, so the
//         worker needs the same pure function, not a second implementation.
//   · card-art.ts — the per-card looping artwork, keyed by card id. Vendored
//     into this app's src/lib/ only (the worker never renders a card). It holds
//     worker-RELATIVE paths so the copy is verbatim; the phone joins its API
//     origin on top in src/lib/card-art-url.ts.
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
const ROOT = path.resolve(__dirname, "..", "..");
const web = (file) => path.resolve(ROOT, "src", "lib", file);
const mobile = (file) => path.resolve(ROOT, "mobile-app", "src", "lib", file);
const worker = (file) => path.resolve(ROOT, "worker", "src", "lib", file);
const flue = (file) => path.resolve(ROOT, "flue-agent", "src", "lib", file);

// [source file, [[label, destination], …]]
const FILES = [
  [
    "suggestions.ts",
    [
      ["mobile", mobile("suggestions.ts")],
      ["worker", worker("suggestions.ts")],
    ],
  ],
  ["card-art.ts", [["mobile", mobile("card-art.ts")]]],
  // The script-specialist roster. Travels one hop further than the deck does,
  // because the flue agent needs the same list to validate which specialist is
  // stamping a pass — a doctor that isn't on the roster must not be able to
  // write one, and the roster it checks against has to be THE roster.
  [
    "specialists.ts",
    [
      ["mobile", mobile("specialists.ts")],
      ["worker", worker("specialists.ts")],
      ["flue", flue("specialists.ts")],
    ],
  ],
];

const banner = (file) =>
  `// VENDORED from shot-studio/src/lib/${file} — DO NOT EDIT HERE.\n` +
  "// Edit the web copy, then run `npm --prefix mobile-app run sync:suggestions`\n" +
  "// (scripts/sync-suggestions.mjs).\n";

let wrote = 0;
for (const [file, dsts] of FILES) {
  const src = web(file);
  if (!fs.existsSync(src)) {
    console.error(`[sync] source not found: ${src}`);
    console.error("[sync] run this from inside the shot-studio repo (needs ../src/lib).");
    process.exit(1);
  }
  const next = banner(file) + "\n" + fs.readFileSync(src, "utf8");
  for (const [name, dst] of dsts) {
    const current = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : null;
    if (current === next) {
      console.log(`[sync] ${name}: ${file} already up to date.`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, next);
    console.log(`[sync] ${name}: ${file} → ${path.relative(ROOT, dst)}`);
    wrote += 1;
  }
}
if (!wrote) process.exit(0);
