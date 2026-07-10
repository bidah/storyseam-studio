import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  pinned?: boolean;
}

// The model sees this as `new_draft`. Creates a new script version and pins it,
// so subsequent edits don't overwrite the previous draft.
export default defineTool({
  description:
    "Create a new script draft (version) and PIN it, so the previous draft is preserved and further edits (yours and the user's) go to the new one. By default the new draft is a copy of the current pinned draft (so the user can keep revising from where they are); pass blank:true to start from an empty script. Use this before a big rewrite the user might want to undo, or when they ask for 'a new draft/version'.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Name for the new draft, e.g. 'Draft 2' or 'tighter open'. Auto-numbered if omitted."),
    blank: z
      .boolean()
      .optional()
      .describe("Start the new draft empty instead of copying the current pinned draft."),
  }),
  async execute({ name, blank }) {
    const data = await api<{ draft?: DraftMeta; pinnedId?: string }>(
      "/api/script/drafts",
      { method: "POST", body: { name, blank: !!blank } },
    );
    return {
      ok: true,
      created: data.draft?.name ?? name ?? null,
      pinned: data.draft?.name ?? null,
      note: "The new draft is now pinned — edits from here go to it.",
    };
  },
});
