import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `list_library`.
export default defineTool({
  description:
    "List the project image library grouped by folder, marking which images are currently selected (promoted to final_selection). Each image has a `rel` path used by toggle_library and select_reference.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/library");
  },
});
