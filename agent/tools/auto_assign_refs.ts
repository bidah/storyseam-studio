import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `auto_assign_refs`.
export default defineTool({
  description:
    "Auto-assign selected Library images to episode bundles by classifying each image (character/location/etc.) and matching bundle role requirements, and pick one voice reference per bundle. Overwrites existing per-bundle image + audio picks. Returns a summary of how many images each bundle got.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/episode/auto-assign", { method: "POST" });
  },
});
