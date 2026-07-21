import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const attachVisualGeneration = (api: Api) =>
  defineTool({
    name: "attach_visual_generation",
    description:
      "Attach a generated concept image to the World › Visual tab by URL. Appends a new generation and downloads the image so it shows up live on the tab. Call this after generating an image with the visual-world skill (Higgsfield MCP generate_image → job_status result_url). ALWAYS pass `prompt` and `model`, and `refs` when you used any image references, so the generation records how it was made. Returns the created generation.",
    input: v.object({
      url: d(v.pipe(v.string(), v.url()), "Remote URL of the generated image (png/jpg/webp) — the job_status result_url."),
      prompt: v.optional(d(v.string(), "The EXACT scene prompt you sent the model (without the style preset prefix).")),
      assembledPrompt: v.optional(d(v.string(), "The full prompt actually sent, including any style-preset prefix.")),
      model: v.optional(d(v.string(), "The image model id you used, e.g. the Nano Banana Pro id from models_explore.")),
      aspectRatio: v.optional(d(v.string(), "Aspect ratio you generated at, e.g. '16:9'.")),
      presetId: v.optional(d(v.string(), "Id of the prompt-library preset used, if any.")),
      refs: v.optional(
        d(
          v.array(
            v.object({
              kind: v.optional(d(v.string(), "'library' or 'generation'.")),
              rel: v.optional(d(v.string(), "Library image rel, when kind='library'.")),
              genId: v.optional(d(v.string(), "Source generation id, when kind='generation'.")),
              url: v.optional(d(v.string(), "The reference image URL you passed.")),
            }),
          ),
          "The reference images you passed as image_references for this generation (lineage).",
        ),
      ),
    }),
    async run({ input, signal }) {
      return await api.post("/api/visual-world/image", input, signal);
    },
  });
