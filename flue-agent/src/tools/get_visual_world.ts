import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getVisualWorld = (api: Api) =>
  defineTool({
    name: "get_visual_world",
    description:
      "Read the Visual World from the World › Visual tab — the visual exploration of how the series looks. Returns { settings, prompts, sheetPrompts, generations, board }. `settings` carries the PROJECT GENERATION DEFAULTS the user set on the Settings page — `settings.model` (image model id; empty string = Nano Banana Pro) and `settings.aspectRatio` (normally 16:9) — ALWAYS generate with these unless the user explicitly overrides in chat. `prompts` is the reusable prompt library (each { id, name, image, video }); use a preset's `image` text as the house style. `sheetPrompts` is { character, location } — the project's character-sheet and location-sheet prompt blocks, layered between the style preset and the scene when generating a design sheet (see the sheet-generation skill). `generations` is the concept images so far, each { id, status: 'processing'|'ready'|'error', prompt, model, aspectRatio, url, refUrl, refs }. `board` is the reference-lineage canvas. To pass a prior generation back as an image reference, feed its `refUrl` (an absolute https URL) to Higgsfield `media_import_url` — NOT `url`, which is a relative in-app path Higgsfield cannot fetch. Call this before generating so you build on what's there, and before save_visual_prompt so you don't clobber the prompt library.",
    async run({ signal }) {
      return await api.get("/api/visual-world", signal);
    },
  });
