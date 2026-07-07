import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `list_sounds`.
export default defineTool({
  description:
    "List every Sound Studio track (newest first) with its versions, each version's prompt, status (pending|ready), like flag, and media URL. Use to see what audio exists before creating or rendering.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/sounds");
  },
});
