import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { docToElements } from "../lib/script.js";

interface DraftMeta {
  id: string;
  name: string;
  updatedAt?: string;
  lineCount?: number;
  pinned?: boolean;
}

// The model sees this as `get_script`.
export default defineTool({
  description:
    "Read the current screenplay from the Script tab. This reads the PINNED draft — the single active version that the user's editor and all your script edits operate on. Returns the title and a flat `elements` array of screenplay lines ({ type, text }) where type is one of scene_heading, action, character, dialogue, parenthetical, transition, plus the pinned draft's name and the list of all drafts. Use before editing so you know what is already written on the pinned draft.",
  inputSchema: z.object({}),
  async execute() {
    const data = await api<{
      title?: string;
      doc?: unknown;
      updatedAt?: string;
      draftName?: string;
      pinnedId?: string;
      drafts?: DraftMeta[];
    }>("/api/script");
    const elements = docToElements(data.doc);
    return {
      title: data.title || "",
      elements,
      lineCount: elements.length,
      updatedAt: data.updatedAt ?? null,
      pinnedDraft: data.draftName ?? null,
      drafts: (data.drafts || []).map((d) => ({
        name: d.name,
        pinned: !!d.pinned,
        lineCount: d.lineCount ?? 0,
      })),
    };
  },
});
