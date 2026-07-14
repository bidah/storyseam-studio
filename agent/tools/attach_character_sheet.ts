import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `attach_character_sheet`.
export default defineTool({
  description:
    "Link a project library image to a World character as their character-sheet reference (the portrait shown on the World tab). Pass the character's `id` (from get_world) and the image's `rel` path (from list_library) — the image must already be in the asset library. The full url/thumb/name are resolved from the library for you. Pass `clear: true` (no rel) to unlink the current sheet. When more than one image could fit, DON'T guess — show the candidate thumbnails as markdown (`![](thumb-url)`) and ask_question which one before calling this.",
  inputSchema: z.object({
    characterId: z.string().min(1).describe("Character id from get_world, e.g. char-abc123-0."),
    rel: z
      .string()
      .optional()
      .describe("Project-relative path of the library image (the `rel` field from list_library). Omit when clearing."),
    clear: z.boolean().optional().describe("Set true to unlink the character's current sheet image."),
  }),
  async execute({ characterId, rel, clear }) {
    const path = `/api/world/character/${encodeURIComponent(characterId)}`;
    if (clear || !rel) {
      return await api(path, { method: "PUT", body: { sheetImage: null } });
    }
    // Resolve the rel against the asset library so the World tab gets a full
    // { rel, url, thumb, name } (rendered without a second lookup) — and so we
    // fail loudly if the image isn't actually in the library.
    const lib = await api<{ folders?: Array<{ images?: any[] }> }>("/api/library");
    const im = (lib?.folders || []).flatMap((f) => f.images || []).find((x: any) => x.rel === rel);
    if (!im) {
      throw new Error(`No library image with rel "${rel}". Call list_library to see valid rel paths.`);
    }
    return await api(path, {
      method: "PUT",
      body: { sheetImage: { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name } },
    });
  },
});
