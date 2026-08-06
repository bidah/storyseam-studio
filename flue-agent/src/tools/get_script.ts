import { defineTool } from "@flue/runtime";
import type { Api, Json } from "../lib/api.js";
import { docToElements } from "../lib/script.js";

export const getScript = (api: Api) =>
  defineTool({
    name: "get_script",
    description:
      "Read the current screenplay from the Script tab. Reads the PINNED draft — the single active version the editor and all script edits operate on. Returns the title, the flat `elements` list (each line is { type, text }; its 0-based position in the array is the `index` you pass to edit_script), the pinned draft name, and the list of drafts. Use before editing so you know what is already written and which line index to target. Returns the COMMITTED content, not any still-pending proposal.",
    async run({ signal }) {
      const data = (await api.get("/api/script", signal)) as unknown as {
        title?: string;
        doc?: Json;
        updatedAt?: string;
        draftName?: string;
        drafts?: Array<{ name?: string; pinned?: boolean; lineCount?: number }>;
        proposal?: unknown;
      };
      // Flatten the TipTap doc to the same { type, text } line list the write
      // tools speak, numbered by array position. This is what edit_script
      // targets: the model reads a line's index here and edits it in place
      // instead of re-emitting the whole document.
      const elements = docToElements(data.doc ?? null);
      return {
        output: {
          title: data.title ?? "",
          elements: elements as unknown as Json,
          lineCount: elements.length,
          updatedAt: data.updatedAt ?? null,
          pendingProposal: !!data.proposal,
          pinnedDraft: data.draftName ?? null,
          drafts: (data.drafts ?? []).map((d) => ({
            name: d.name ?? "",
            pinned: !!d.pinned,
            lineCount: d.lineCount ?? 0,
          })),
        },
      };
    },
  });
