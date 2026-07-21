import { defineTool } from "@flue/runtime";
import type { Api, Json } from "../lib/api.js";

// NOTE: eve's get_script ran the TipTap doc through docToElements to return a
// flat `elements` array. That transform (agent/lib/script.ts) is ported in
// Phase 2; the slice returns the raw script payload to prove the read path.
export const getScript = (api: Api) =>
  defineTool({
    name: "get_script",
    description:
      "Read the current screenplay from the Script tab. Reads the PINNED draft — the single active version the editor and all script edits operate on. Returns the title, the TipTap document, the pinned draft name, and the list of drafts. Use before editing so you know what is already written.",
    async run({ signal }) {
      const data = (await api.get("/api/script", signal)) as unknown as {
        title?: string;
        doc?: Json;
        updatedAt?: string;
        draftName?: string;
        drafts?: Array<{ name?: string; pinned?: boolean; lineCount?: number }>;
        proposal?: unknown;
      };
      return {
        title: data.title ?? "",
        doc: data.doc ?? null,
        updatedAt: data.updatedAt ?? null,
        pendingProposal: !!data.proposal,
        pinnedDraft: data.draftName ?? null,
        drafts: (data.drafts ?? []).map((d) => ({
          name: d.name ?? "",
          pinned: !!d.pinned,
          lineCount: d.lineCount ?? 0,
        })),
      };
    },
  });
