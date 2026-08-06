import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const createEpisode = (api: Api) =>
  defineTool({
    name: "create_episode",
    description:
      "Create the NEXT episode of a series. The new episode gets its own script, shot list, animatic and cut; the world bible (title, story map, locations, character library) is shared, and any ANCHORED characters are carried into it while everything else starts fresh. Only meaningful when the project's format is \"series\" — set that with set_format first. IMPORTANT: your tools stay bound to the CURRENT episode this conversation is on, so you cannot build the new episode from here — after creating it, tell the author to switch to it in the header (Ep menu), which opens that episode's own conversation.",
    input: v.object({
      title: v.optional(d(v.string(), "Optional title for the new episode (defaults to \"Episode N\").")),
    }),
    async run({ data, signal }) {
      return { output: await api.post("/api/episodes", data, signal) };
    },
  });
