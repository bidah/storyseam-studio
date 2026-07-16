import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_still`.
export default defineTool({
  description:
    "Attach a generated storyboard STILL to one shot inside an episode bundle by URL. Appends a new take (keeps prior takes) and downloads the image so it shows in the Episode tab's Images mode and on the animatic's picture track. This is the still-image equivalent of attach_episode_video, used after generating a still with the generate-storyboard skill (Nano Banana Pro via the Higgsfield MCP). Multiple takes per shot accumulate so different camera angles can be compared and one selected. ALWAYS pass `prompt`, `model` and `refs` — they record how the image was made, and the Editor's 'New still…' modal prefills from them so a human can regenerate a variation without reconstructing your intent. Returns the take's `file`, which is what edit_timeline's `replace` op needs to put this still on the timeline.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id the shot belongs to, e.g. MS-01."),
    shot: z.string().min(1).describe("Shot id within the bundle, e.g. MS-012."),
    url: z.url().describe("Remote URL of the generated still image (png/jpg/webp)."),
    angle: z
      .string()
      .optional()
      .describe("Optional short note on the camera angle / variation for this take, e.g. 'low angle CU'."),
    jobId: z.string().optional().describe("Optional Higgsfield job id for reference."),
    prompt: z
      .string()
      .optional()
      .describe("The EXACT prompt text you sent to the image model. Recorded so this take can be regenerated or tweaked later."),
    model: z
      .string()
      .optional()
      .describe("The image model id you actually used (as resolved via models_explore), e.g. 'nano_banana_pro'."),
    refs: z
      .array(
        z.object({
          key: z.string().optional().describe("Reference key, e.g. 'helena' or 'school-clearing'."),
          role: z.string().optional().describe("What it locks: 'character' or 'location'."),
          url: z.string().optional().describe("The reference image URL you passed to the model."),
        }),
      )
      .optional()
      .describe("The reference images you actually passed as image_references for this generation."),
    shotSnapshot: z
      .object({
        location: z.string().optional(),
        camera: z.string().optional(),
        action: z.string().optional(),
        dialogue: z.string().optional(),
        dur: z.number().optional(),
      })
      .optional()
      .describe("The shot's data AT generation time — so a later edit can tell whether the shot has changed since."),
  }),
  async execute({ bundle, shot, url, angle, jobId, prompt, model, refs, shotSnapshot }) {
    return await api("/api/storyboard/image", {
      method: "POST",
      body: { bundle, shot, url, angle, jobId, prompt, model, refs, shotSnapshot },
    });
  },
});
