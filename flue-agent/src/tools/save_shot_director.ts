import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";
import { inputSchema } from "../lib/schema-to-valibot.js";
import shotDirectorsSchema from "../schemas/shot-directors.json";

// Description and input both come from the SHARED contract
// (shared/schemas/shot-directors.json) — the same file POST /api/shot-directors
// validates against, so the Settings page and this tool can't drift apart about
// what editing a director means.
export const saveShotDirector = (api: Api) =>
  defineTool({
    name: "save_shot_director",
    description: shotDirectorsSchema.description,
    input: inputSchema(shotDirectorsSchema),
    async run({ data, signal }) {
      return { output: await api.post("/api/shot-directors", data, signal) };
    },
  });
