import { defineAgent } from "eve";
import { modelConfig } from "../../../../lib/model";

// Arc expert (nested under story-architect): the Hero's Journey. Only the
// story-architect delegates here. It maps the 12 stages onto the given premise
// and returns a beat outline.
export default defineAgent({
  ...modelConfig(),
  description:
    "Hero's Journey (Campbell / Vogler, 12 stages) structure expert. Given a premise, maps the monomyth stages — Ordinary World through Return with the Elixir — onto this story and returns a beat-by-beat outline. Best for mythic, adventure-shaped arcs with a transformed protagonist.",
});
