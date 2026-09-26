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
//   src/lib/plugins.ts      → worker + flue-agent copies    (npm run plugins:sync)
//   src/lib/series.ts       → worker + flue-agent copies    (npm run series:sync)
//   src/lib/shot-sheet.ts   → worker + flue-agent copies    (npm run series:sync)
//   shared/schemas/*.json   → worker + flue-agent copies    (npm run schemas:sync)
//   src/lib/moodboard-document.js → worker copy             (npm run moodboard:sync)
//   world-creation SKILL.md § shape → worker auto-prompts    (npm run auto:sync)
//
// Every one of them fails silently when it drifts. Edit the timeline model and
// forget the sync, and the Vercel render path renders LAST WEEK'S composition
// with no error anywhere; edit the genui contract and the agent gets prompted
// with components the renderers don't have. CLAUDE.md says "run the sync" in
// four places — this is that instruction, enforced.

import { join } from "node:path";
import { ROOT, read, exists, stripBanner, rel } from "./lib.mjs";
import { renderAutoPrompts, AUTO_PROMPTS_TARGET } from "../sync-auto-prompts.mjs";

// [canonical, vendored copy, the command that re-syncs it]
const PAIRS = [
  ["src/editor/RemotionRoot.jsx", "render-fn/remotion/RemotionRoot.jsx", "npm --prefix render-fn run sync"],
  ["src/editor/Composition.jsx", "render-fn/remotion/Composition.jsx", "npm --prefix render-fn run sync"],
  ["src/editor/timeline.js", "render-fn/remotion/timeline.js", "npm --prefix render-fn run sync"],
  ["src/genui/contract.ts", "mobile-app/src/genui/contract.ts", "npm run genui:sync"],
  ["src/genui/detect-options.ts", "mobile-app/src/genui/detect-options.ts", "npm run genui:sync"],
  ["src/genui/card-kind.ts", "mobile-app/src/genui/card-kind.ts", "npm run genui:sync"],
  ["src/lib/suggestions.ts", "mobile-app/src/lib/suggestions.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/suggestions.ts", "worker/src/lib/suggestions.ts", "npm --prefix mobile-app run sync:suggestions"],
  // The script-specialist roster. Three copies, because the ledger's whitelist
  // (worker), the Chat deck (mobile) and record_script_review's own guard
  // (flue-agent) must all agree on who the specialists are — a drifted copy
  // means a doctor whose pass the worker rejects, or a card for an agent that
  // no longer exists.
  ["src/lib/specialists.ts", "mobile-app/src/lib/specialists.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/specialists.ts", "worker/src/lib/specialists.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/specialists.ts", "flue-agent/src/lib/specialists.ts", "npm --prefix mobile-app run sync:suggestions"],
  ["src/lib/routeTable.js", "desktop/main/routeTable.js", "npm --prefix desktop run sync"],
  // The plugin catalog. Three surfaces must agree on which tabs exist and which
  // are optional: the header draws them, the Worker validates an install against
  // them, and the agent refuses a tool whose plugin isn't installed. A drifted
  // copy is an agent offering to install something that doesn't exist.
  ["src/lib/plugins.ts", "worker/src/lib/plugins.ts", "npm run plugins:sync"],
  ["src/lib/plugins.ts", "flue-agent/src/lib/plugins.ts", "npm run plugins:sync"],
  // The Series model. Every number in it is a ceiling the Director endpoint
  // enforces by refusing the whole session at `configure` — so the form, the
  // Worker and the agent all check the same list. A drifted copy is a form that
  // promises a cue sheet the endpoint will refuse, after the frames were drawn.
  ["src/lib/series.ts", "worker/src/lib/series.ts", "npm run series:sync"],
  ["src/lib/series.ts", "flue-agent/src/lib/series.ts", "npm run series:sync"],
  ["src/lib/shot-sheet.ts", "worker/src/lib/shot-sheet.ts", "npm run series:sync"],
  ["src/lib/shot-sheet.ts", "flue-agent/src/lib/shot-sheet.ts", "npm run series:sync"],
  ["src/lib/music-plan.ts", "worker/src/lib/music-plan.ts", "npm run series:sync"],
  ["src/lib/music-plan.ts", "flue-agent/src/lib/music-plan.ts", "npm run series:sync"],
  ["src/lib/film-plan.ts", "worker/src/lib/film-plan.ts", "npm run series:sync"],
  ["src/lib/film-plan.ts", "flue-agent/src/lib/film-plan.ts", "npm run series:sync"],
  ["src/lib/score-mix.ts", "worker/src/lib/score-mix.ts", "npm run series:sync"],
  ["src/lib/score-mix.ts", "flue-agent/src/lib/score-mix.ts", "npm run series:sync"],
  ["src/lib/music-cues.ts", "worker/src/lib/music-cues.ts", "npm run series:sync"],
  ["src/lib/music-cues.ts", "flue-agent/src/lib/music-cues.ts", "npm run series:sync"],
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
  // Generated (not copied) — sections of the world-creation, shot-list and model-sheets playbooks turned
  // into a JS string for the Auto Film job, so compare against a fresh render.
  let rendered = null;
  try { rendered = renderAutoPrompts(); } catch (err) { violations.push(String(err?.message || err)); }
  if (rendered != null) {
    if (!exists(AUTO_PROMPTS_TARGET)) {
      violations.push(`${AUTO_PROMPTS_TARGET} has never been generated. Run \`npm run auto:sync\`.`);
    } else if (read(AUTO_PROMPTS_TARGET) !== rendered) {
      violations.push(
        `${AUTO_PROMPTS_TARGET} has drifted from the world-creation / shot-list / model-sheets playbooks. Run \`npm run auto:sync\` (edit the SKILL.md, never the copy).`,
      );
    }
  }
  return violations;
}
