import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveSeedancePrompt = (api: Api) =>
  defineTool({
    name: "save_seedance_prompt",
    description:
      "Overwrite the Seedance (video) prompt block for one shot in the shotlist file. Rewrites ONLY that shot's SHOT: NN block, preserving the rest of the file.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Shot id, e.g. shot03."),
      text: d(v.string(), "The full replacement Seedance prompt text for this shot."),
    }),
    async run({ data: input, signal }) {
      const { id, text } = input;
      return {
        output: await api.req(
          `/api/shots/${encodeURIComponent(String(id))}/seedance`,
          "PUT",
          { text },
          signal,
        ),
      };
    },
  });
