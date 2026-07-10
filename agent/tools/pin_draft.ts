import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  pinned?: boolean;
}

// The model sees this as `pin_draft`. Switches which draft is active by name.
export default defineTool({
  description:
    "Switch the PINNED (active) draft to the named one. After this, get_script/save_script/append_script and the user's editor all operate on that draft. Use when the user asks to switch/go back to a version. Call list_drafts first if unsure of the exact name.",
  inputSchema: z.object({
    name: z.string().describe("The exact draft name to pin (see list_drafts)."),
  }),
  async execute({ name }) {
    const { drafts = [] } = await api<{ drafts?: DraftMeta[] }>("/api/script/drafts");
    // Exact match first, then case-insensitive, so the user can be loose.
    const target =
      drafts.find((d) => d.name === name) ||
      drafts.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (!target) {
      return {
        ok: false,
        error: `No draft named "${name}". Available: ${drafts.map((d) => d.name).join(", ") || "(none)"}.`,
      };
    }
    await api("/api/script/pin", { method: "POST", body: { id: target.id } });
    return { ok: true, pinned: target.name };
  },
});
