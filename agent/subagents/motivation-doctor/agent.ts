import { defineAgent } from "eve";
import { modelConfig } from "../../lib/model";

// Script specialist: the motivation & causality doctor — "the whys". A different
// lane from plot-doctor (logical/continuity coherence) and story-architect
// (structure): this one checks that everything that happens is *caused* by
// character psychology — a want, a wound/trauma, a fear, a need — rather than
// happening for plot convenience. Advisor pattern — it recommends; the root
// applies.
export default defineAgent({
  ...modelConfig(),
  description:
    "Motivation & causality doctor — the 'why' behind everything that happens. Delegate to it to check that every action, choice, reversal, and event is *caused* — rooted in a character's want, wound/trauma, fear, or need — rather than occurring for plot convenience. It surfaces unmotivated beats and 'and then' coincidences and prescribes the backstory/trauma or causal link that would justify or replace them. A different lane from plot-doctor (logical/continuity coherence) and story-architect (structure). Pass the script or scene in the message; it returns the missing 'whys' with fixes. It analyzes and recommends — it does not edit the script itself.",
});
