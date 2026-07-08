import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `score_cut`.
export default defineTool({
  description:
    "Add the Sound Studio background-music cues UNDER the stitched complete cut, producing a NEW scored version (previous versions are kept for A/B). Each cue is pinned to the first bundle of its beat and mixed at a low bed level (~-22 dB by default) so the baked-in dialogue/SFX stay dominant. Returns the new version number, its URL, the bed level in dB, and the cues used. Requires the cut to be stitched first (stitch_cuts) and at least one rendered music cue. Optionally pass gainDb to set the bed level (e.g. -26 for quieter, -18 for louder).",
  inputSchema: z.object({
    gainDb: z
      .number()
      .max(0)
      .optional()
      .describe(
        "Music bed level in dB relative to the dialogue (negative; lower = quieter). Omit to use the default (~-22 dB).",
      ),
  }),
  async execute({ gainDb }) {
    const body =
      typeof gainDb === "number" ? { gain: Math.pow(10, gainDb / 20) } : undefined;
    return await api("/api/episode/score", { method: "POST", body });
  },
});
