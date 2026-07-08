import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_shotlist`.
export default defineTool({
  description:
    "Read the granular per-shot Shot list (the flat list of every ~2-3s shot, before packing into <=15s multishots). Each shot has { n, id, beat, beatTitle, dur, location, characters, camera, action, dialogue, audioSync, prompt } where `prompt` is the Seedance prompt. Also returns `packs`: the live <=15s multishot grouping (how the shots compound into MS-01, MS-02 …). Use before save_shotlist so you don't clobber existing shots.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/shotlist");
  },
});
