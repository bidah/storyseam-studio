import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const stitchCuts = (api: Api) =>
  defineTool({
    name: "stitch_cuts",
    description:
      "Stitch the selected take of every bundle (in order) into a NEW versioned complete-cut mp4 (complete_cut_vN.mp4) with ffmpeg — never overwrites a prior version, so the browser can't show a stale cached cut. If background music was added before, the fresh cut is automatically re-scored so the newest version keeps its music (carriedMusic=true). Returns { url, file, version, kind, carriedMusic, totalDuration, count }. Requires at least one rendered+selected take.",
    async run({ signal }) {
      return await api.post("/api/episode/stitch", undefined, signal);
    },
  });
