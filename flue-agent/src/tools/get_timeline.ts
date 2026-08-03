import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getTimeline = (api: Api) =>
  defineTool({
    name: "get_timeline",
    description:
      "Read the video editor's current timeline (the editable per-clip version of a complete cut shown in the Editor tab). Returns { timeline, cuts }: `timeline` is { fps, width, height, tracks[] } where each track (video/music) has items { id, src, name, from, durationInFrames, volume } measured in FRAMES at `fps`; `timeline` is null if nothing is loaded yet. `cuts` lists the complete-cut generations you can load. Call this first before editing so you know each item's id, order, and frame positions.",
    async run({ signal }) {
      return { output: await api.get("/api/timeline", signal) };
    },
  });
