import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";
import { inputSchema } from "../lib/schema-to-valibot.js";
import timelineSchema from "../schemas/timeline.json";

export const editTimeline = (api: Api) =>
  defineTool({
    name: "edit_timeline",
    // Description and input both come from the SHARED contract
    // (shared/schemas/timeline.json, vendored into src/schemas/) — the same file
    // POST /api/timeline/edit validates against, so the op list the model reads
    // and the op list the route accepts cannot drift apart.
    description: timelineSchema.description,
    input: inputSchema(timelineSchema),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/timeline/edit", { ops: input.ops }, signal) };
    },
  });
