import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const attachCharacterSheet = (api: Api) =>
  defineTool({
    name: "attach_character_sheet",
    description:
      "Link a project library image to a World character as their character-sheet reference (the portrait shown on the World tab). Pass the character's `id` (from get_world) and the image's `rel` path (from list_library) — the image must already be in the asset library. The full url/thumb/name are resolved from the library for you. Pass `clear: true` (no rel) to unlink the current sheet. When more than one image could fit, DON'T guess — draw the candidate thumbnails with render_ui (a MediaGrid) and let the user pick before calling this.",
    input: v.object({
      characterId: d(
        v.pipe(v.string(), v.minLength(1)),
        "Character id from get_world, e.g. char-abc123-0.",
      ),
      rel: v.optional(
        d(
          v.string(),
          "Project-relative path of the library image (the `rel` field from list_library). Omit when clearing.",
        ),
      ),
      clear: v.optional(
        d(v.boolean(), "Set true to unlink the character's current sheet image."),
      ),
    }),
    async run({ data: input, signal }) {
      const { characterId, rel, clear } = input;
      const path = `/api/world/character/${encodeURIComponent(String(characterId))}`;
      if (clear || !rel) {
        return { output: await api.req(path, "PUT", { sheetImage: null }, signal) };
      }
      // Resolve the rel against the asset library so the World tab gets a full
      // { rel, url, thumb, name } (rendered without a second lookup) — and so we
      // fail loudly if the image isn't actually in the library.
      const lib = await api.get<{
        folders?: Array<{ images?: any[] }>;
      }>("/api/library", signal);
      const im = (lib?.folders || [])
        .flatMap((f) => f.images || [])
        .find((x: any) => x.rel === rel);
      if (!im) {
        throw new Error(
          `No library image with rel "${rel}". Call list_library to see valid rel paths.`,
        );
      }
      return {
        output: await api.req(
          path,
          "PUT",
          {
            sheetImage: { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name },
          },
          signal,
        ),
      };
    },
  });
