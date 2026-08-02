import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const commitPacing = (api: Api) =>
  defineTool({
    name: "commit_pacing",
    description:
      "Commit the paced Editor timeline's timing back to the Shot list: sets each shot's `dur` to its realized screen time so everything derived from the shot list (animatic, <=15s multishot packs, episode video requests) inherits the pacing. Works when the Editor holds a radio or animatic timeline. Only durs change — shot ids, order, and every other field are preserved. On a radio timeline, the air between two lines goes to the voiced shot (take + a ~0.4s breath) and the silent shots between them (split proportional to their planned durs). Call ONLY after the user has approved the pacing — this rewrites the shot list's timing and reshuffles the multishot packing, so it's the point of no easy return before video generation. Returns { ok, source, updated, unchanged, untouched, changes:[{shot, n, from, to}] }.",
    async run({ signal }) {
      return { output: await api.post("/api/radio/commit-pacing", {}, signal) };
    },
  });
