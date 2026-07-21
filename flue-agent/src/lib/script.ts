// Helpers for the Script tab: convert between the TipTap/ProseMirror document
// stored at /api/script and a flat, screenplay-friendly `elements` array that is
// easy for the model to read and write. Each element is one screenplay line:
//   { type: "scene_heading" | "action" | "character" | "dialogue"
//          | "parenthetical" | "transition", text: string }
// Ported verbatim from eve's agent/lib/script.ts (pure functions).

export const SCRIPT_ELEMENT_TYPES = [
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
] as const;

export type ScriptElementType = (typeof SCRIPT_ELEMENT_TYPES)[number];

export interface ScriptElement {
  type: ScriptElementType;
  text: string;
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
}
interface PMDoc {
  type: "doc";
  content: PMNode[];
}

function textOf(node: PMNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content || []).map(textOf).join("");
}

function normalizeType(t: unknown): ScriptElementType {
  return (SCRIPT_ELEMENT_TYPES as readonly string[]).includes(t as string)
    ? (t as ScriptElementType)
    : "action";
}

// elements → a ProseMirror doc of `screenplay` nodes (what the editor renders).
export function elementsToDoc(elements: ScriptElement[]): PMDoc {
  const content: PMNode[] = (elements || [])
    .filter((el) => el && typeof el.text === "string")
    .map((el) => {
      const text = el.text ?? "";
      return {
        type: "screenplay",
        attrs: { spType: normalizeType(el.type) },
        content: text ? [{ type: "text", text }] : [],
      };
    });
  // Never persist an empty doc — the editor schema needs at least one block.
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// A ProseMirror doc → the flat elements array (empty blocks dropped).
export function docToElements(doc: unknown): ScriptElement[] {
  const d = doc as PMDoc | null;
  const blocks =
    d && d.type === "doc" && Array.isArray(d.content) ? d.content : [];
  const out: ScriptElement[] = [];
  for (const node of blocks) {
    if (node.type === "title") continue; // legacy; title lives outside the doc
    const text = textOf(node).trim();
    if (!text) continue; // drop empty paragraphs / trailing escape-hatch node
    const type =
      node.type === "screenplay" ? normalizeType(node.attrs?.spType) : "action";
    out.push({ type, text });
  }
  return out;
}
