import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const setEpisodeStyle = (api: Api) =>
  defineTool({
    name: "set_episode_style",
    description:
      "Choose the render STYLE prepended to episode bundle prompts. Without `bundle` it sets the " +
      "episode-wide style every scene follows; with `bundle` it overrides one scene. `presetId` is a " +
      "visual-world style-prompt id (list them via get_visual_world — e.g. the seeded 'preset-2d' 2D " +
      "storybook look), omitted/empty to clear — NO style, which is the default and is right when the " +
      "image references alone should carry the look (e.g. realistic renders) — or, per-scene only, " +
      "the sentinel \"none\" to force that one scene style-free while the episode has a style. " +
      "Styles are applied to the composed skillPrompt at read time, so no rebuild is needed.",
    input: v.object({
      presetId: v.optional(
        d(
          v.string(),
          'Visual-world style-prompt id; "" / omitted clears (no style); "none" (with bundle) forces one scene style-free.',
        ),
      ),
      bundle: v.optional(
        d(
          v.pipe(v.string(), v.minLength(1)),
          "Bundle id, e.g. MS-01 — omit to set the episode-wide style.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { bundle, presetId } = input;
      return {
        output: await api.post(
          "/api/episode/style",
          { bundle: bundle || null, presetId: presetId || "" },
          signal,
        ),
      };
    },
  });
