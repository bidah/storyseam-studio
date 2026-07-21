import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getVisualWorld = (api: Api) =>
  defineTool({
    name: "get_visual_world",
    description:
      "Read the Visual World from the World › Visual tab — the visual exploration of how the series looks. Returns { settings, prompts, generations, board }. `prompts` is the reusable prompt library (each { id, name, image, video }); use a preset's `image` text as the house style. `generations` is the concept images so far, each { id, status: 'processing'|'ready'|'error', prompt, model, aspectRatio, url, refs }. `board` is the reference-lineage canvas. Call this before generating so you build on what's there (and can pass a prior generation back as an image reference), and before save_visual_prompt so you don't clobber the prompt library.",
    async run({ signal }) {
      return await api.get("/api/visual-world", signal);
    },
  });
