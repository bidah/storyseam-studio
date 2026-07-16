import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_radio_take`.
export default defineTool({
  description:
    "Link a rendered voice take to a Radio-version dialogue line so it shows under that line on the Radio tab (and gets laid into the timeline when the user sends it to the Editor). Call this after create_sound → seed-audio render → attach_sound, passing the same track id + version you just attached. Get line ids from get_radio (scene.lines[].id, e.g. 'sh3').",
  inputSchema: z.object({
    lineId: z.string().min(1).describe("The radio line id from get_radio, e.g. 'sh3'."),
    trackId: z.string().min(1).describe("The Sound Studio track id of the rendered voice take, e.g. 'trk_7'."),
    v: z.number().int().positive().describe("The version number of that track that was rendered + attached."),
  }),
  async execute({ lineId, trackId, v }) {
    return await api(`/api/radio/take/${encodeURIComponent(lineId)}`, {
      method: "PUT",
      body: { trackId, v },
    });
  },
});
