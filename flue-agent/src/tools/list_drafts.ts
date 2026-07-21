import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  updatedAt?: string;
  lineCount?: number;
  pinned?: boolean;
}

export const listDrafts = (api: Api) =>
  defineTool({
    name: "list_drafts",
    description:
      "List the script's drafts (versions) and which one is PINNED. The pinned draft is the active version — get_script/save_script/append_script all read and write only the pinned draft. Use this when the user asks about versions/drafts, or before switching or creating one.",
    async run({ signal }) {
      const data = (await api.get("/api/script/drafts", signal)) as unknown as {
        drafts?: DraftMeta[];
        pinnedId?: string;
      };
      const drafts = (data.drafts || []).map((dr) => ({
        name: dr.name,
        pinned: !!dr.pinned,
        lineCount: dr.lineCount ?? 0,
        updatedAt: dr.updatedAt ?? null,
      }));
      return {
        drafts,
        pinned: drafts.find((dr) => dr.pinned)?.name ?? null,
        count: drafts.length,
      };
    },
  });
