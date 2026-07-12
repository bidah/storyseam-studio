import { defineAgent } from "eve";
import { modelConfig } from "../../../../lib/model";

// Arc expert (nested under story-architect): the 4-act, conflict-optional
// kishōtenketsu structure.
export default defineAgent({
  ...modelConfig(),
  description:
    "Kishōtenketsu structure expert (4 acts: Ki / Shō / Ten / Ketsu). Given a premise, maps this conflict-optional structure — which turns on a surprising third-act twist rather than escalating conflict — onto the story and returns a 4-part outline. Best for gentle, contemplative, or slice-of-life episodes.",
});
