import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listLibrary = (api: Api) =>
  defineTool({
    name: "list_library",
    description:
      "List the project image library grouped by folder, marking which images are currently selected (promoted to final_selection). Each image has a `rel` path (used by toggle_library and select_reference) and a `refUrl` — an absolute https URL. Each image also has `thumb` (~400px webp) and `display` (~1600px webp) — downscaled copies for SHOWING the author; use `thumb` as the src of a render_ui MediaGrid tile. To use a library image as a generation REFERENCE, feed its `refUrl` to Higgsfield `media_import_url`; do NOT use `url`/`thumb`/`display`/`rel` — the first and last are relative in-app paths Higgsfield cannot fetch, and the tiers are shrunken copies that would cost the generation detail. `refUrl` is the only field that resolves to the full-resolution original.",
    async run({ signal }) {
      return { output: await api.get("/api/library", signal) };
    },
  });
