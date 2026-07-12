import { defineAgent } from "eve";
import { modelConfig } from "../../lib/model";

// Script specialist: the plot-hole & continuity doctor. The root agent delegates
// to it by name. `description` is what the parent reads to decide when to hand
// off, so keep it specific (docs/subagents.mdx: description is mandatory).
//
// Advisor pattern: this subagent is isolated (no script tools), so it does NOT
// edit the screenplay. The root reads the script with get_script, passes it in,
// and applies the returned fixes with save_script / new_draft.
export default defineAgent({
  ...modelConfig(),
  description:
    "Plot-hole & continuity doctor for the screenplay. Delegate to it to audit the script for logical gaps, plot holes, continuity/timeline errors, unmotivated character behavior, unplanted setups and unpaid payoffs, and to get concrete, coherence-restoring fixes. Pass the current script (or the scenes in question) in the message; it returns a prioritized issue list with a suggested fix for each. It analyzes and recommends — it does not edit the script itself.",
});
