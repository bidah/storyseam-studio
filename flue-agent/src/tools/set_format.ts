import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const setFormat = (api: Api) =>
  defineTool({
    name: "set_format",
    description:
      "Set whether this project is a one-off FEATURE film or an episodic SERIES. A series unlocks per-episode scripts, shot lists and cuts plus the episode switcher in the header; the world bible (title, story map, locations, character library) is shared across episodes, and characters marked as anchors carry into every new episode. Stored on the world bible. Set this before creating episodes.",
    input: v.object({
      format: d(v.picklist(["feature", "series"]), '"feature" or "series".'),
    }),
    async run({ data, signal }) {
      return { output: await api.req("/api/world", "PUT", { format: data.format }, signal) };
    },
  });
