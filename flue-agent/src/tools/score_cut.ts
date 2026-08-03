import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const scoreCut = (api: Api) =>
  defineTool({
    name: "score_cut",
    description:
      "Add the Sound Studio background-music cues UNDER the latest music-free stitched cut, producing a NEW versioned scored generation (complete_cut_vN.mp4; previous versions are kept in history for A/B). Each cue is pinned to the first bundle of its beat and mixed at a low bed level (~-22 dB by default) so the baked-in dialogue/SFX stay dominant. Returns the new version number, its URL, the bed level in dB, and the cues used. Requires the cut to be stitched first (stitch_cuts) and at least one rendered music cue. Optionally pass gainDb to set the bed level (e.g. -26 for quieter, -18 for louder).",
    input: v.object({
      gainDb: v.optional(
        d(
          v.pipe(v.number(), v.maxValue(0)),
          "Music bed level in dB relative to the dialogue (negative; lower = quieter). Omit to use the default (~-22 dB).",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { gainDb } = input;
      const body =
        typeof gainDb === "number"
          ? { gain: Math.pow(10, gainDb / 20) }
          : undefined;
      return { output: await api.post("/api/episode/score", body, signal) };
    },
  });
