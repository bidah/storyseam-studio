import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getWorld = (api: Api) =>
  defineTool({
    name: "get_world",
    description:
      "Read the World bible from the World tab — the series' foundational world. Returns { title, logline, map, depth, characters }. `map` is the 5 shaping questions { world, protagonist, antagonist, stakes, theme }; `depth` is the core story elements { premise, wantVsNeed, conflict, obstacles, structure }; `characters` is the roster, each { id, name, archetype, role, want, need, traits, arc, voice, appearance, sheetImage, voiceRef }. `sheetImage` is the linked character-sheet image ({ rel, url, thumb, name, refUrl } or null — feed `refUrl`, an absolute https URL, to Higgsfield `media_import_url` to reference the sheet; `url` is a relative path Higgsfield can't fetch, and `thumb` is a ~400px webp for showing the author, never generation input) and `voiceRef` is the attached voice ({ trackId, v, name, url } or null) — set these with attach_character_sheet / attach_character_voice, not by hand. Call this before save_world so you extend the existing world instead of clobbering it.",
    async run({ signal }) {
      return { output: await api.get("/api/world", signal) };
    },
  });
