import { defineAgent } from "eve";
import { modelConfig } from "../../../../lib/model";

// Arc expert (nested under story-architect): the classic three-act structure.
export default defineAgent({
  ...modelConfig(),
  description:
    "Three-Act structure expert (Setup / Confrontation / Resolution, with inciting incident, two plot points, midpoint, and climax). Given a premise, maps the classic dramatic spine onto this story and returns a beat outline. The safe, general-purpose default when no other structure is requested.",
});
