import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_sound`.
export default defineTool({
  description:
    "Attach a rendered audio file to a pending sound version — from a remote URL (downloaded) or a local file path (copied). Flips the version to 'ready', probes its duration, and makes it play in the UI. This is the final step of the render→attach loop after generating with the seed-audio skill.",
  inputSchema: z
    .object({
      id: z.string().min(1).describe("Track id, e.g. trk_2."),
      v: z.number().int().positive().describe("Version number to attach to."),
      url: z.url().optional().describe("Remote URL of the rendered audio (mp3/wav/…)."),
      localPath: z.string().optional().describe("Absolute local path to the rendered audio file."),
    })
    .refine((x) => x.url || x.localPath, { message: "Provide 'url' or 'localPath'." }),
  async execute({ id, v, url, localPath }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}/version/${v}/attach`, {
      method: "POST",
      body: { url, localPath },
    });
  },
});
