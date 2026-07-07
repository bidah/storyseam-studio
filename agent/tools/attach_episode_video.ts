import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_episode_video`.
export default defineTool({
  description:
    "Attach a rendered Seedance clip to an episode bundle by URL. Appends a new generation (keeps prior takes) — downloads the clip into the bundle's generations. This is the video equivalent of attach_sound, used after rendering with the generate-multishot / continue-video skills.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    url: z.url().describe("Remote URL of the rendered mp4."),
    jobId: z.string().optional().describe("Optional Higgsfield job id for reference."),
  }),
  async execute({ bundle, url, jobId }) {
    return await api("/api/episode/video", { method: "POST", body: { bundle, url, jobId } });
  },
});
