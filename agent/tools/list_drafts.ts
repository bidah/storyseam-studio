import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

interface DraftMeta {
  id: string;
  name: string;
  updatedAt?: string;
  lineCount?: number;
  pinned?: boolean;
}

// The model sees this as `list_drafts`. Lets the agent see every saved version
// of the script and which one is pinned (the active one it edits).
export default defineTool({
  description:
    "List the script's drafts (versions) and which one is PINNED. The pinned draft is the active version — get_script/save_script/append_script all read and write only the pinned draft. Use this when the user asks about versions/drafts, or before switching or creating one.",
  inputSchema: z.object({}),
  async execute() {
    const data = await api<{ drafts?: DraftMeta[]; pinnedId?: string }>(
      "/api/script/drafts",
    );
    const drafts = (data.drafts || []).map((d) => ({
      name: d.name,
      pinned: !!d.pinned,
      lineCount: d.lineCount ?? 0,
      updatedAt: d.updatedAt ?? null,
    }));
    return {
      drafts,
      pinned: drafts.find((d) => d.pinned)?.name ?? null,
      count: drafts.length,
    };
  },
});
