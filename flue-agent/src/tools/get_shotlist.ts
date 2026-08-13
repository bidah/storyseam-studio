import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getShotlist = (api: Api) =>
  defineTool({
    name: "get_shotlist",
    description:
      "Read the granular per-shot Shot list (the flat list of every ~2-3s shot, before packing into <=15s multishots). Each shot has { n, id, beat, beatTitle, dur, location, characters, camera, action, dialogue, audioSync, prompt } where `prompt` is the Seedance prompt. Also returns `packs` (the live <=15s multishot grouping — how the shots compound into MS-01, MS-02 …), `director`/`promptForm` (the prompt system this project writes shots with — read the full brief with get_shot_director), and `progress`: the SCRIPT COVERAGE marker { throughIndex, throughLine, note, complete, draft } saying how far through the screenplay this list already reaches. When the author asks for the next chunk of shots, `progress` is where you resume — start at throughIndex + 1 rather than re-reading the script from the top. Use before save_shotlist so you don't clobber existing shots.",
    async run({ signal }) {
      return { output: await api.get("/api/shotlist", signal) };
    },
  });
