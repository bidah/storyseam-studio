import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `sign_bundle`.
export default defineTool({
  description:
    "Sign off (or clear) one section of an episode bundle: 'images', 'prompt', or 'audio'. Signing records who signed and when; clearing removes the signature. Ask the user for their name (signedBy) if not known.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    section: z.enum(["images", "prompt", "audio"]),
    signed: z.boolean().describe("true to sign, false to clear the signature."),
    signedBy: z.string().optional().describe("Name of the signer (required when signed=true)."),
  }),
  async execute({ bundle, section, signed, signedBy }) {
    return await api("/api/episode/sign", {
      method: "POST",
      body: { bundle, section, signed, signedBy },
    });
  },
});
