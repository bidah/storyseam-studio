import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const loadCutIntoEditor = (api: Api) =>
  defineTool({
    name: "load_cut_into_editor",
    description:
      "Load a complete cut into the video editor timeline — its ordered video clips plus the music bed, exactly as the cut was assembled. Replaces whatever timeline was loaded before. Use when the user wants to 'edit the complete cut', 'open the cut in the editor', or start editing a specific version. `v` picks the cut generation (see get_timeline's `cuts` list); omit `v` to load the latest generation. Returns { ok, timeline }.",
    input: v.object({
      v: v.optional(
        d(
          v.pipe(v.number(), v.integer()),
          "Cut generation version to load (from get_timeline's `cuts`). Omit for the latest.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { v } = input;
      return { output: await api.post("/api/timeline/from-cut", { v }, signal) };
    },
  });
