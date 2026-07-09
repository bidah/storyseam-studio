import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `edit_timeline`.
export default defineTool({
  description:
    "Edit the video editor timeline by applying a list of ops (call get_timeline first for item ids, track ids, and frame positions; times are FRAMES at the timeline fps, usually 24). Ops:\n" +
    "- move: set a clip's start frame — { op:'move', id, from }\n" +
    "- resize: set a clip's length in frames (trims/extends the end) — { op:'resize', id, durationInFrames }\n" +
    "- remove: delete a clip/music item — { op:'remove', id }\n" +
    "- volume: set gain 0..2 (1 = unity, 0 = silent) — { op:'volume', id, volume }\n" +
    "- mute: mute/unmute an item — { op:'mute', id, muted }\n" +
    "- disable: disable/enable a clip — skipped in playback but kept on the timeline (greyed) — { op:'disable', id, disabled }\n" +
    "- reorder: set the play order of a track then close gaps — { op:'reorder', track:'video', order:[id,id,...] }\n" +
    "- repack: close gaps in a track so clips play back-to-back — { op:'repack', track:'video' }\n" +
    "Track ids are 'video' and 'music'. Reordering video clips almost always wants a following repack (reorder already repacks). Returns { ok, timeline } with the updated timeline.",
  inputSchema: z.object({
    ops: z
      .array(
        z.object({
          op: z
            .enum(["move", "resize", "remove", "volume", "mute", "reorder", "repack"])
            .describe("The edit operation."),
          id: z.string().optional().describe("Target item id (for move/resize/remove/volume/mute)."),
          track: z.string().optional().describe("Target track id 'video' or 'music' (for reorder/repack)."),
          from: z.number().optional().describe("Start frame (for move)."),
          durationInFrames: z.number().optional().describe("Length in frames (for resize)."),
          volume: z.number().optional().describe("Gain 0..2 (for volume)."),
          muted: z.boolean().optional().describe("Mute flag (for mute)."),
          order: z.array(z.string()).optional().describe("Ordered item ids (for reorder)."),
        }),
      )
      .describe("The ordered list of edit ops to apply."),
  }),
  async execute({ ops }) {
    return await api("/api/timeline/edit", { method: "POST", body: { ops } });
  },
});
