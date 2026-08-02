import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  pinned?: boolean;
}

export const pinDraft = (api: Api) =>
  defineTool({
    name: "pin_draft",
    description:
      "Switch the PINNED (active) draft to the named one. After this, get_script/save_script/append_script and the user's editor all operate on that draft. Use when the user asks to switch/go back to a version. Call list_drafts first if unsure of the exact name.",
    input: v.object({
      name: d(v.string(), "The exact draft name to pin (see list_drafts)."),
    }),
    async run({ data: input, signal }) {
      const { name } = input as { name: string };
      const { drafts = [] } = (await api.get(
        "/api/script/drafts",
        signal,
      )) as unknown as { drafts?: DraftMeta[] };
      // Exact match first, then case-insensitive, so the user can be loose.
      const target =
        drafts.find((dr) => dr.name === name) ||
        drafts.find((dr) => dr.name.toLowerCase() === name.toLowerCase());
      if (!target) {
        return {
          output: {
            ok: false,
            error: `No draft named "${name}". Available: ${
              drafts.map((dr) => dr.name).join(", ") || "(none)"
            }.`,
          } as Json,
        };
      }
      await api.post("/api/script/pin", { id: target.id }, signal);
      return { output: { ok: true, pinned: target.name } as Json };
    },
  });
