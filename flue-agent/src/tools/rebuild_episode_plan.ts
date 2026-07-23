import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const rebuildEpisodePlan = (api: Api) =>
  defineTool({
    name: "rebuild_episode_plan",
    description:
      "Rebuild the episode plan (the packed <=15s multishot bundles) from the CURRENT shot list — same as the Episode tab's rebuild button. Run this after the shot list changes, or when auto_assign_refs reports there is no episode manifest yet. The remap is lossless where it matters: storyboard stills follow their shot, rendered videos follow their bundle's shots, and ref/audio picks + prompts + signoffs are kept only for bundles whose shot membership is unchanged (a re-packed bundle needs re-review — re-run auto_assign_refs for those). Returns bundle counts and what was carried over.",
    async run({ signal }) {
      return await api.post("/api/episode/rebuild", undefined, signal);
    },
  });
