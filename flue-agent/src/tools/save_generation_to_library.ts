import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveGenerationToLibrary = (api: Api) =>
  defineTool({
    name: "save_generation_to_library",
    description:
      "Promote a Visual World generation into the project asset library (the Worker copies the image bytes server-side) and return its library `rel`. This is the REQUIRED bridge between a generated sheet and the World roster: attach_character_sheet / attach_location_sheet only accept a library `rel`, and Visual-tab generations are NOT in the library until saved. Pass the generation `id` (from get_visual_world or the attach_visual_generation result). Optional `folder`/`name` pick where it lands. NEVER try to download/re-upload image bytes yourself (bash has no network access) — this tool is the only way, and it needs no network on your side.",
    input: v.object({
      id: d(
        v.pipe(v.string(), v.minLength(1)),
        "Generation id, e.g. gen-abc123-0f00aa (from get_visual_world / attach_visual_generation).",
      ),
      folder: v.optional(
        d(v.string(), 'Library folder to save into, e.g. "locations". Defaults to the library root.'),
      ),
      name: v.optional(
        d(v.string(), "Base filename (no extension). Defaults to the generation's filename."),
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/visual-world/save-to-library", input, signal) };
    },
  });
