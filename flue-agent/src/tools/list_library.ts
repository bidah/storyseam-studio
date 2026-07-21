import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listLibrary = (api: Api) =>
  defineTool({
    name: "list_library",
    description:
      "List the project image library grouped by folder, marking which images are currently selected (promoted to final_selection). Each image has a `rel` path used by toggle_library and select_reference.",
    async run({ signal }) {
      return await api.get("/api/library", signal);
    },
  });
