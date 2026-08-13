import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

// The project's SHOT DIRECTOR — the author-editable prompt system every shot's
// render prompt is written with. It is what makes the shot-list skills follow
// THIS project's brief rather than only their own generic text: the author edits
// the director on the Settings page, and the next shot written obeys the edit.
export const getShotDirector = (api: Api) =>
  defineTool({
    name: "get_shot_director",
    description:
      "Read the SHOT DIRECTOR — the prompt system this project writes shot render prompts with, editable by the author on the Settings page. Call it BEFORE authoring any shot (the initial shot list, a chunk of it, or a single inserted shot) and follow the `instructions` it returns: they are the author's brief and they OVERRIDE the generic guidance in the shot-list skills wherever the two differ. `promptForm` decides WHERE the prompt goes — \"paragraph\" means the whole render prompt goes in the single `prompt` field (as one vivid paragraph, or as the labelled single-shot document the instructions specify — follow them), \"blocks\" means send `promptBlocks` and no `prompt`. By default returns just the ACTIVE director for the project's production type; pass `all: true` to also list every director the author can switch between (built-ins plus their own saved versions) with the active one per production type — do that only when the request is about choosing or editing a director, since the instruction texts are long.",
    input: v.object({
      all: v.optional(
        d(
          v.boolean(),
          "Also return every available director and the active one per production type. Use it when the author asks which directors exist, wants to switch, or wants one edited — not when you are simply about to write shots.",
        ),
      ),
    }),
    async run({ data, signal }) {
      if (data?.all) {
        return { output: await api.get("/api/shot-directors", signal) };
      }
      return { output: await api.get("/api/shot-directors/active", signal) };
    },
  });
