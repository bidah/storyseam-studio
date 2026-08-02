import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const saveVisualPrompt = (api: Api) =>
  defineTool({
    name: "save_visual_prompt",
    description:
      "Overwrite the Visual World prompt library (the reusable style presets shown in the composer's prompt selector). REPLACES the whole list — call get_visual_world first and send back every preset you want to keep, adding or editing as needed. Use when the user wants to save a refined style prompt for reuse. Returns the saved prompts.",
    input: v.object({
      prompts: d(
        v.array(
          v.object({
            id: v.optional(d(v.string(), "Existing preset id (from get_visual_world). Omit for a new preset.")),
            name: d(v.string(), "Short preset name."),
            image: v.optional(d(v.string(), "The image style block — style, palette, composition. Prepended to the scene.")),
            video: v.optional(d(v.string(), "Optional camera/motion clauses kept for later Seedance renders.")),
          }),
        ),
        "The FULL prompt library to save (keep the presets you're not changing).",
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.req("/api/visual-world/prompts", "PUT", input, signal) };
    },
  });
