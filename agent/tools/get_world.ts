import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_world`.
export default defineTool({
  description:
    "Read the World bible from the World tab — the series' foundational world. Returns { title, logline, map, depth, characters }. `map` is the 5 shaping questions { world, protagonist, antagonist, stakes, theme }; `depth` is the core story elements { premise, wantVsNeed, conflict, obstacles, structure }; `characters` is the roster, each { id, name, archetype, role, want, need, traits, arc, voice, appearance }. Call this before save_world so you extend the existing world instead of clobbering it.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/world");
  },
});
