import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_multishot`.
export default defineTool({
  description:
    "Get the multishot experiment manifest (shots 1–4 combined clip experiment) with any generated media URLs.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/multishot");
  },
});
