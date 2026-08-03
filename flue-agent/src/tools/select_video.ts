import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const selectVideo = (api: Api) =>
  defineTool({
    name: "select_video",
    description:
      "Mark one rendered generation of a bundle as selected (or not) for the final stitch. Only selected takes are included by stitch_cuts. `file` is the generation's file name from get_episode.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      file: d(
        v.pipe(v.string(), v.minLength(1)),
        "Generation file name, e.g. MS-01_gen2.mp4.",
      ),
      selected: v.boolean(),
    }),
    async run({ data: input, signal }) {
      const { bundle, file, selected } = input;
      return {
        output: await api.post(
          "/api/episode/video-select",
          { bundle, file, selected },
          signal,
        ),
      };
    },
  });
