import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveEpisodePrompt = (api: Api) =>
  defineTool({
    name: "save_episode_prompt",
    description:
      "Save (or clear) the per-bundle skill-prompt override for one episode bundle. Pass empty/omitted text to clear the override so the bundle falls back to the live-composed prompt.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      text: v.optional(
        d(v.string(), "Override prompt text; omit or empty to clear."),
      ),
    }),
    async run({ input, signal }) {
      const { bundle, text } = input;
      return await api.post("/api/episode/prompt", { bundle, text }, signal);
    },
  });
