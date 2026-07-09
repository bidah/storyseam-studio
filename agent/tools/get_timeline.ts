import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_timeline`.
export default defineTool({
  description:
    "Read the video editor's current timeline (the editable per-clip version of a complete cut shown in the Editor tab). Returns { timeline, cuts }: `timeline` is { fps, width, height, tracks[] } where each track (video/music) has items { id, src, name, from, durationInFrames, volume } measured in FRAMES at `fps`; `timeline` is null if nothing is loaded yet. `cuts` lists the complete-cut generations you can load via load_cut_into_editor ({ v, kind, clips, music, withMusic }). Call this first before editing so you know each item's id, order, and frame positions.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/timeline");
  },
});
