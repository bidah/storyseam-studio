import { defineAgent } from "eve";
import { modelConfig } from "../../../../lib/model";

// Arc expert (nested under story-architect): Dan Harmon's Story Circle.
export default defineAgent({
  ...modelConfig(),
  description:
    "Story Circle (Dan Harmon, 8 steps: You / Need / Go / Search / Find / Take / Return / Change) structure expert. Given a premise, maps the want-vs-need loop onto this story and returns an 8-beat outline. Best for tight episodic TV and character change in a small space.",
});
