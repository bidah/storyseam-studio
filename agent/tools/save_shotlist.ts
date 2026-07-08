import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `save_shotlist`. Replaces the WHOLE shot list — read it
// first with get_shotlist if you only mean to tweak part of it.
export default defineTool({
  description:
    "Replace the entire Shot list on the Shot list tab with a new ordered list of shots (the granular per-shot breakdown that auto-packs into <=15s multishot bundles). Writes shotlist.json and OVERWRITES all shots — call get_shotlist first if revising. Each shot's `beat`/`beatTitle` and `location` drive the packing (a bundle never crosses a beat or location and never exceeds 15s), so keep consecutive same-location shots grouped and give a realistic `dur`. `prompt` is the Seedance prompt (fold any 2D-directing intent directly into it). Returns the shot count and the resulting <=15s pack preview.",
  inputSchema: z.object({
    shots: z
      .array(
        z.object({
          id: z.string().optional().describe("Shot id, e.g. \"01\". Omit to auto-number."),
          beat: z.string().describe("Beat code, e.g. \"B1\" — packing boundary."),
          beatTitle: z.string().optional().describe("Human beat title, e.g. \"Beat 1 — School clearing\"."),
          dur: z.number().describe("Estimated shot length in seconds (drives the <=15s packing)."),
          location: z.string().describe("Location slug, e.g. \"school-clearing\" — a bundle never crosses locations."),
          characters: z.array(z.string()).optional().describe("Characters on screen, e.g. [\"Helena\",\"Sara\"]."),
          camera: z.string().optional().describe("Camera/framing + move."),
          action: z.string().describe("What happens in the shot."),
          dialogue: z.string().optional().describe("Spoken line(s), or \"(no dialogue)\"."),
          audioSync: z.string().optional().describe("Audio-sync note (the line/SFX this shot lands on)."),
          prompt: z.string().describe("The Seedance prompt for this shot."),
        }),
      )
      .describe("The full ordered shot list, top to bottom."),
    source: z.string().optional().describe("Provenance tag, e.g. \"agent\". Defaults to \"agent\"."),
  }),
  async execute({ shots, source }) {
    return await api("/api/shotlist", { method: "POST", body: { shots, source: source || "agent" } });
  },
});
