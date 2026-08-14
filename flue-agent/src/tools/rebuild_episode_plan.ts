import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const rebuildEpisodePlan = (api: Api) =>
  defineTool({
    name: "rebuild_episode_plan",
    description:
      "Rebuild the episode plan (the packed <=15s multishot bundles) from the CURRENT shot list — same as the Episode tab's build/rebuild buttons. Run this after the shot list changes, or when auto_assign_refs reports there is no episode manifest yet. With no arguments it builds a card for EVERY pack the shot list yields — only do that when the shot list is complete (get_shotlist progress.complete). While the shot list is still being generated one ~15s pass at a time, pass `bundles` with the pack ids to build (get_episode's shotlist.packs lists them with a `built` flag) — a partial build only ADDS those cards and never drops existing ones. The remap is lossless where it matters: storyboard stills follow their shot, rendered videos follow their bundle's shots, and ref/audio picks + prompts + signoffs are kept only for bundles whose shot membership is unchanged (a re-packed bundle needs re-review — re-run auto_assign_refs for those). Returns bundle counts and what was carried over.",
    input: v.object({
      bundles: v.optional(
        d(
          v.array(v.pipe(v.string(), v.minLength(1))),
          'Pack ids to build cards for, e.g. ["MS-03"] — a partial build that only adds those cards. Pass [] to re-pack only the already-built cards. Omit for a full rebuild of every pack (complete shot list only).',
        ),
      ),
    }),
    async run({ data: input, signal }) {
      return {
        output: await api.post(
          "/api/episode/rebuild",
          input.bundles ? { bundles: input.bundles } : undefined,
          signal,
        ),
      };
    },
  });
