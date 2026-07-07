import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `rename_sound`.
export default defineTool({
  description: "Rename a Sound Studio track.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Track id, e.g. trk_2."),
    name: z.string().min(1).describe("New track name."),
  }),
  async execute({ id, name }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
  },
});
