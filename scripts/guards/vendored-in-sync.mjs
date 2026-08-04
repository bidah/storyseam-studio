// GUARD: every vendored copy matches its canonical source.
//
// This repo vendors four things across package boundaries, because Metro, the
// Vercel bundler, the Electron main process and the flue build each resolve
// modules from their own root and can't reach across:
//
//   src/editor/*            → render-fn/remotion/*        (npm --prefix render-fn run sync)
//   src/genui/*             → mobile-app/src/genui/*      (npm run genui:sync)
//   src/lib/suggestions.ts  → mobile-app + worker copies   (npm --prefix mobile-app run sync:suggestions)
//   src/lib/routeTable.js   → desktop/main/routeTable.js   (npm --prefix desktop run sync)
//   shared/schemas/*.json   → worker + flue-agent copies    (npm run schemas:sync)
//   src/lib/moodboard-document.js → worker copy             (npm run moodboard:sync)
//
// Every one of them fails silently when it drifts. Edit the timeline model and
// forget the sync, and the Vercel render path renders LAST WEEK'S composition
// with no error anywhere; edit the genui contract and the agent gets prompted
// with components the renderers don't have. CLAUDE.md says "run the sync" in
// four places — this is that instruction, enforced.

import { join } from "node:path";
import { ROOT, read, exists, stripBanner, rel } from "./lib.mjs";

// [canonical, vendored copy, the command that re-syncs it]
const PAIRS = [
  ["src/editor/RemotionRoot.jsx", "render-fn/remotion/RemotionRoot.jsx", "npm --prefix render-fn run sync"],
  ["src/editor/Composition.jsx", "render-fn/remotion/Composition.jsx", "npm --prefix render-fn run sync"],
  ["src/editor/timeline.js", "render-fn/remotion/timeline.js", "npm --prefix render-fn run sync"],
  ["src/genui/contract.ts", "mobile-app/src/genui/contract.ts", "npm run genui:sync"],
  ["src/genui/detect-options.ts", "mobile-app/src/genui/detect-options.ts", "npm run genui:sync"],
  ["src/lib/suggestions.ts", "mobile-app/src/lib/suggestions.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/suggestions.ts", "worker/src/lib/suggestions.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/routeTable.js", "desktop/main/routeTable.js", "npm --prefix desktop run sync"],
  // The moodboard op reducer. Applied optimistically on the client AND
  // authoritatively inside the Worker's updateDoc CAS — a drifted copy means
  // cards that silently snap back to a different position after a reload.
  ["src/lib/moodboard-document.js", "worker/src/lib/moodboard-document.js", "npm run moodboard:sync"],
  // Capability contracts. JSON can't carry a "generated" banner, so these copies
  // are byte-identical to the source and compare verbatim — which is also why
  // the warning not to edit them lives in shared/schemas/README.md.
  ["shared/schemas/shotlist.json", "worker/src/schemas/shotlist.json", "npm run schemas:sync"],
  ["shared/schemas/shotlist.json", "flue-agent/src/schemas/shotlist.json", "npm run schemas:sync"],
  ["shared/schemas/timeline.json", "worker/src/schemas/timeline.json", "npm run schemas:sync"],
  ["shared/schemas/timeline.json", "flue-agent/src/schemas/timeline.json", "npm run schemas:sync"],
];

export const name = "vendored-in-sync";
export const describe = "vendored copies match their canonical source";

export function run() {
  const violations = [];
  for (const [source, copy, command] of PAIRS) {
    if (!exists(source)) {
      violations.push(`${rel(join(ROOT, source))} is missing — the guard's source list is stale.`);
      continue;
    }
    if (!exists(copy)) {
      violations.push(`${copy} has never been generated. Run \`${command}\`.`);
      continue;
    }
    if (stripBanner(read(source)) !== stripBanner(read(copy))) {
      violations.push(
        `${copy} has drifted from ${source}. Run \`${command}\` (edit the canonical file, never the copy).`,
      );
    }
  }
  return violations;
}
