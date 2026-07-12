import { defineAgent } from "eve";
import { modelConfig } from "../../lib/model";

// Script specialist: the story architect (the "arc agent"). When the user starts
// building a story or wants to (re)structure one, the root delegates here. This
// subagent interviews the user for which narrative framework they want, then
// hands off to the matching nested arc-expert subagent (./subagents/*) and
// returns the assembled beat outline for the root to write into the script.
export default defineAgent({
  ...modelConfig(),
  description:
    "Story architect for building a new story or restructuring an existing one. Delegate here when the user wants to plot/outline a story, choose a narrative structure, or map the episode to an arc. It asks the user which arc to build (hero's journey, story circle, three-act, save-the-cat, kishotenketsu, or other), then consults the matching in-house arc expert and returns a beat-by-beat outline fitted to the premise. It outlines — the root writes the outline into the script.",
});
