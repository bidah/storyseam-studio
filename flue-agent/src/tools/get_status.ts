import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getStatus = (api: Api) =>
  defineTool({
    name: "get_status",
    description:
      "Where the episode stands right now — one compact digest of the WHOLE pipeline, counts and flags only (no content). Call this first for 'what's the status', 'where are we', 'what should I do next', or before proposing a next step, instead of fetching every section. Returns { stage, world, script, visualWorld, shotlist, storyboard, radio, sounds, episode, cuts }: `stage` is the single word for what's blocking progress (\"world\" | \"script\" | \"visual\" | \"shots\" | \"board\" | \"voice\" | \"render\" | \"cut\" | \"done\"); `world` has map/depth filled-vs-total plus which fields are `missing` and which characters/locations are `missingSheet`/`missingVoice`; `script` has lines, drafts, signed, hasProposal and `reviews` — which specialists have read this revision, bucketed { pending, stale, fresh } (`pending` = never run, `stale` = the script changed since its pass), so you can offer the doctor that hasn't looked yet; `storyboard` has withStill vs shots and the `missing` shot numbers; `radio` has voiced vs lines. It is a summary — use get_world / get_script / get_shotlist when you need the actual content.",
    async run({ signal }) {
      return { output: await api.get("/api/status", signal) };
    },
  });
