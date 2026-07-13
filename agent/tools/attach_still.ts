import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_still`.
export default defineTool({
  description:
    "Attach a generated storyboard STILL to one shot inside an episode bundle by URL. Appends a new take (keeps prior takes) and downloads the image so it shows in the Episode tab's Images mode. This is the still-image equivalent of attach_episode_video, used after generating a still with the generate-storyboard skill (Nano Banana Pro via the Higgsfield MCP). Multiple takes per shot accumulate so different camera angles can be compared and one selected.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id the shot belongs to, e.g. MS-01."),
    shot: z.string().min(1).describe("Shot id within the bundle, e.g. MS-012."),
    url: z.url().describe("Remote URL of the generated still image (png/jpg/webp)."),
    angle: z
      .string()
      .optional()
      .describe("Optional short note on the camera angle / variation for this take, e.g. 'low angle CU'."),
    jobId: z.string().optional().describe("Optional Higgsfield job id for reference."),
  }),
  async execute({ bundle, shot, url, angle, jobId }) {
    return await api("/api/storyboard/image", { method: "POST", body: { bundle, shot, url, angle, jobId } });
  },
});
