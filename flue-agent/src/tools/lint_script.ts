import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

// The mechanical pass — the one no specialist should be spent on. It runs
// worker-side over the pinned draft's elements, costs nothing, and returns in
// one call what a doctor would otherwise burn a whole delegation counting. It is
// deliberately NOT in the specialists roster: it makes no judgements, so it
// never records a review and never appears on the board as a pass.
export const lintScript = (api: Api) =>
  defineTool({
    name: "lint_script",
    description:
      "Check the pinned draft for MECHANICAL screenplay-format faults, and measure it. FREE and INSTANT — no model, no credits, no delegation — so run it freely: before delegating any specialist (so the doctor spends its pass on the writing rather than on formatting), after a big save_script/append_script, and any time the author asks about length. Returns { issues, stats }. `issues` are the faults a machine can prove: dialogue with no character cue above it, a character cue with no dialogue under it, malformed or missing sluglines, character-name drift (SARA vs Sara vs SARAH — the same person spelled several ways, which silently splits a role in casting and the Radio pass), stray or duplicated transitions, empty elements. Each carries where it is and what to change. `stats` counts scenes, elements by type, speaking characters with a LINE COUNT PER CHARACTER, and the runtime estimate — `estimatedSeconds` and a formatted `estimatedRuntime`. Use those for EVERY \"how long is this episode\", \"is this too long\", \"how many lines does Helena have\" question instead of counting by hand or guessing from the page count. This is NOT a specialist pass: it makes no craft judgement, records nothing on the review board, and never substitutes for a doctor — a script can lint perfectly clean and still be broken.",
    async run({ signal }) {
      return { output: await api.get("/api/script/lint", signal) };
    },
  });
