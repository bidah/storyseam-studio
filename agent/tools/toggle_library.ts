import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `toggle_library`.
export default defineTool({
  description:
    "Select or deselect a library image by its `rel` path. Selecting copies it into final_selection/ (making it available as an episode reference); deselecting removes it and drops it from any bundle picks. Toggles based on current state.",
  inputSchema: z.object({
    rel: z.string().min(1).describe("Project-relative path of the image (from list_library)."),
  }),
  async execute({ rel }) {
    return await api("/api/library/toggle", { method: "POST", body: { rel } });
  },
});
