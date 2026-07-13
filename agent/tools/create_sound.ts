import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `create_sound`.
export default defineTool({
  description:
    "Create a new Sound Studio track with an initial version 1 from a Seed Audio prompt. The version starts status 'pending' — render it with the seed-audio skill, then attach_sound to mark it ready. Returns the created track (with its id, e.g. trk_3).",
  inputSchema: z.object({
    prompt: z.string().min(1).describe("The Seed Audio text prompt for this sound."),
    name: z.string().optional().describe("Optional display name for the track."),
    kind: z
      .enum(["music", "sfx", "voice"])
      .optional()
      .describe(
        "Which Sound Studio tab the track belongs to: 'music' (background music), 'sfx' (sound effect), or 'voice' (voice-acting line). Always set this — voice lines and sound effects are invisible on their tab without it.",
      ),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Optional Seed Audio params (duration, etc.); defaults are used if omitted."),
  }),
  async execute({ prompt, name, kind, params }) {
    return await api("/api/sounds", { method: "POST", body: { prompt, name, kind, params } });
  },
});
