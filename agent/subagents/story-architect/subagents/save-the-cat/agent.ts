import { defineAgent } from "eve";
import { modelConfig } from "../../../../lib/model";

// Arc expert (nested under story-architect): Blake Snyder's Save the Cat! beats.
export default defineAgent({
  ...modelConfig(),
  description:
    "Save the Cat! structure expert (Blake Snyder's 15 beats: Opening Image through Final Image). Given a premise, maps the commercial beat sheet onto this story and returns a beat-by-beat outline with rough placement. Best for a precise, page-aware, commercial structure.",
});
