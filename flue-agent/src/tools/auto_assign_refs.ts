import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const autoAssignRefs = (api: Api) =>
  defineTool({
    name: "auto_assign_refs",
    description:
      "Auto-assign selected Library images to episode bundles by classifying each image (character/location/etc.) and matching bundle role requirements, and pick one voice reference per bundle. Overwrites existing per-bundle image + audio picks. Returns a summary of how many images each bundle got.",
    async run({ signal }) {
      return await api.post("/api/episode/auto-assign", undefined, signal);
    },
  });
