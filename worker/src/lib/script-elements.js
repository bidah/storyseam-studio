// Screenplay ELEMENTS ⇄ the Script tab's ProseMirror document — the Worker's
// copy of flue-agent/src/lib/script.ts (pure functions, ported verbatim), so a
// job on the Worker can write a script the editor opens and the agent's
// get_script reads, without a second document shape.
//
// An element is one screenplay line: { type, text } with type one of
// SCRIPT_ELEMENT_TYPES. `elementsToDoc` is what save_script stores; `docToElements`
// drops empty blocks (right for feeding a model — the linter keeps them, see
// script-lint.js elementsFromDoc).

export const SCRIPT_ELEMENT_TYPES = Object.freeze([
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
]);

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

export const normalizeElementType = (t) => (SCRIPT_ELEMENT_TYPES.includes(t) ? t : "action");

/** A model's `elements` answer → clean elements (typed, trimmed, empties dropped). */
export function cleanElements(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    const text = str(el.text).trim();
    if (!text) continue;
    out.push({ type: normalizeElementType(str(el.type).trim().toLowerCase()), text });
  }
  return out;
}

// elements → a ProseMirror doc of `screenplay` nodes (what the editor renders).
export function elementsToDoc(elements) {
  const content = (elements || [])
    .filter((el) => el && typeof el.text === "string")
    .map((el) => ({
      type: "screenplay",
      attrs: { spType: normalizeElementType(el.type) },
      content: el.text ? [{ type: "text", text: el.text }] : [],
    }));
  // Never persist an empty doc — the editor schema needs at least one block.
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// A ProseMirror doc → the flat elements array (empty blocks dropped).
export function docToElements(doc) {
  const blocks = doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : [];
  const textOf = (node) => {
    if (!node || typeof node !== "object") return "";
    if (typeof node.text === "string") return node.text;
    return (Array.isArray(node.content) ? node.content : []).map(textOf).join("");
  };
  const out = [];
  for (const node of blocks) {
    if (node?.type === "title") continue; // legacy; the title lives outside the doc
    const text = textOf(node).trim();
    if (!text) continue;
    out.push({ type: node?.type === "screenplay" ? normalizeElementType(node?.attrs?.spType) : "action", text });
  }
  return out;
}

/**
 * The screenplay as a model reads it: one line per element, the type in caps
 * before it, so a finding can quote a line exactly ("Sc.2 — HELENA: ...").
 */
export function formatScreenplay(elements) {
  let scene = 0;
  return (elements || [])
    .map((el) => {
      if (el.type === "scene_heading") scene += 1;
      const tag = el.type === "scene_heading" ? `SCENE ${scene}` : el.type.toUpperCase();
      return `${tag}: ${el.text}`;
    })
    .join("\n");
}

/** Counts a card can show: scenes, lines, dialogue words, and an estimated spoken runtime. */
export function screenplayStats(elements) {
  const list = elements || [];
  const scenes = list.filter((el) => el.type === "scene_heading").length;
  const dialogueWords = list
    .filter((el) => el.type === "dialogue")
    .reduce((n, el) => n + el.text.split(/\s+/).filter(Boolean).length, 0);
  const words = list.reduce((n, el) => n + el.text.split(/\s+/).filter(Boolean).length, 0);
  return { scenes, lines: list.length, words, dialogueWords, spokenSeconds: Math.round(dialogueWords / WORDS_PER_SECOND) };
}

/** How fast dialogue plays on screen. ESTIMATE, on the slow side of conversational. */
export const WORDS_PER_SECOND = 2.4;
