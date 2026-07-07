import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_episode`.
export default defineTool({
  description:
    "Get the full episode plan: the multishot bundles (MS-01 …), their rendered video generations, per-bundle prompt overrides, and sign-off state. Use to inspect episode assembly progress.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/episode");
  },
});
