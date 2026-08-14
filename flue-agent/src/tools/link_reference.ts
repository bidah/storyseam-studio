import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const linkReference = (api: Api) =>
  defineTool({
    name: "link_reference",
    description:
      "Tell a bundle which SCENE NEED one of its chosen references covers, for the needs a roster match can't resolve by itself. `need` is a need id from get_episode's `needs`: an image need (\"character:Kid\", \"location:ext-nyc-street\") or a speaker's voice (\"voice:Trini\"). `rel` is a rel already selected for that bundle — an image rel for an image need, an audio rel (select_audio_ref) for a voice need; pass null to unlink. A link only counts while its rel stays selected. A character with a World sheet image or a cast voice needs NO link — that match is automatic.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      need: d(
        v.pipe(v.string(), v.minLength(1)),
        'Need id from get_episode, e.g. "character:Kid" or "voice:Trini".',
      ),
      rel: d(
        v.nullable(v.string()),
        "Rel of the selected reference covering the need, or null to unlink.",
      ),
    }),
    async run({ data: input, signal }) {
      const { bundle, need, rel } = input;
      return {
        output: await api.post("/api/episode/link", { bundle, need, rel }, signal),
      };
    },
  });
