import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  pinned?: boolean;
}

export const newDraft = (api: Api) =>
  defineTool({
    name: "new_draft",
    description:
      "Create a new script draft (version) and PIN it, so the previous draft is preserved and further edits (yours and the user's) go to the new one. By default the new draft is a copy of the current pinned draft (so the user can keep revising from where they are); pass blank:true to start from an empty script. Use this before a big rewrite the user might want to undo, or when they ask for 'a new draft/version'.",
    input: v.object({
      name: v.optional(
        d(
          v.string(),
          "Name for the new draft, e.g. 'Draft 2' or 'tighter open'. Auto-numbered if omitted.",
        ),
      ),
      blank: v.optional(
        d(
          v.boolean(),
          "Start the new draft empty instead of copying the current pinned draft.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { name, blank } = input as { name?: string; blank?: boolean };
      const data = (await api.post(
        "/api/script/drafts",
        { name, blank: !!blank },
        signal,
      )) as unknown as { draft?: DraftMeta; pinnedId?: string };
      return {
        output: {
          ok: true,
          created: data.draft?.name ?? name ?? null,
          pinned: data.draft?.name ?? null,
          note: "The new draft is now pinned — edits from here go to it.",
        },
      };
    },
  });
