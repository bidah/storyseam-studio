import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api, Json } from "../lib/api.js";
import { docToElements } from "../lib/script.js";

export const getScript = (api: Api) =>
  defineTool({
    name: "get_script",
    description:
      "Read the current screenplay from the Script tab. Reads the PINNED draft — the single active version the editor and all script edits operate on. Returns the title, the flat `elements` list (each line is { type, text }; its 0-based position in the array is the `index` you pass to edit_script), the pinned draft name, and the list of drafts. Use before editing so you know what is already written and which line index to target. Returns the COMMITTED content, not any still-pending proposal.",
    input: v.object({
      draftId: v.optional(
        v.pipe(
          v.string(),
          v.description(
            "Read THIS draft instead of the pinned one — any draft id from list_drafts (e.g. a Film's 'First draft' or a writers' room round). Read-only: edits still go to the pinned draft.",
          ),
        ),
      ),
    }),
    async run({ data: args, signal }) {
      if (args?.draftId) {
        const d = (await api.get(`/api/script/drafts/${encodeURIComponent(args.draftId)}`, signal)) as unknown as {
          id: string; name?: string; title?: string; updatedAt?: string; pinned?: boolean; elements?: Json[];
        };
        return {
          output: {
            draftId: d.id,
            draft: d.name ?? null,
            pinned: !!d.pinned,
            title: d.title ?? "",
            elements: (d.elements ?? []) as unknown as Json,
            lineCount: d.elements?.length ?? 0,
            updatedAt: d.updatedAt ?? null,
          } as Json,
        };
      }
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
        } as Json,
      };
    },
  });
