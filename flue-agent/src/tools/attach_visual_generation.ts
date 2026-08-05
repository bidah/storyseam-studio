import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const attachVisualGeneration = (api: Api) =>
  defineTool({
    name: "attach_visual_generation",
    description:
      "Attach a generated concept image to the World › Visual tab by URL. Appends a new generation and downloads the image so it shows up live on the tab. Call this after generating an image with the visual-world skill (Higgsfield MCP generate_image → job_status result_url). ALWAYS pass `prompt` and `model`, and `refs` when you used any image references, so the generation records how it was made. Returns the created generation, including the stored `url` (the full-res original at `/visual-media/...`), `thumb` (~400px webp), `display` (~1600px webp) and `refUrl` (the absolute, full-resolution URL). After attaching, end the turn with a render_ui MediaGrid card whose MediaItem `src` is the `thumb` and whose `display` arg is the `display` webp — so the tile paints instantly and tapping it opens a sharp full-screen look — so the author SEES the image right in the chat, rather than being told it is on the Visual tab. To reuse this image as a generation reference later, pass its `refUrl` — never `thumb`/`display` (downscaled copies) or `url` (a relative path an external model cannot fetch).",
    input: v.object({
      url: d(v.pipe(v.string(), v.url()), "Remote URL of the generated image (png/jpg/webp) — the job_status result_url."),
      prompt: v.optional(d(v.string(), "The EXACT scene prompt you sent the model (without the style preset prefix).")),
      assembledPrompt: v.optional(d(v.string(), "The full prompt actually sent, including any style-preset prefix.")),
      model: v.optional(d(v.string(), "The image model id you used, e.g. the Nano Banana Pro id from models_explore.")),
      aspectRatio: v.optional(d(v.string(), "Aspect ratio you generated at, e.g. '16:9'.")),
      resolution: v.optional(
        d(
          v.picklist(["1k", "2k", "4k"]),
          "Output resolution, when the generate call carried a `resolution` param (project default = get_visual_world settings.resolution). Omit for models without the param.",
        ),
      ),
      presetId: v.optional(d(v.string(), "Id of the prompt-library preset used, if any.")),
      sheetType: v.optional(
        d(
          v.picklist(["character", "location", "prop"]),
          "Set when this image is a design sheet: 'character' for a character model sheet / turnaround, 'location' for a location design sheet, 'prop' for a multi-view prop reference sheet (see the sheet-generation skill). Stamped on the generation as provenance metadata and shown as a badge on the tab. Location and prop sheets are always generated FROM a reference image — pass the reference you used in `refs`.",
        ),
      ),
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
          "The reference images you passed as reference media for this generation (lineage).",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/visual-world/image", input, signal) };
    },
  });
