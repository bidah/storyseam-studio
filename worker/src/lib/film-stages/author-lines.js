// The AUTHOR'S LINES — words the author put in quotation marks in the prompt
// ("…and waves to the camera: "I love New York." The end."). They are the
// author's, not the writers': the Script writes them verbatim, the writers'
// room may not touch them, and a rewrite that drops one gets it put back.
//
// Why this exists: film-6767fc11 (2026-09-27). The Script had "I love New
// York."; the room's dialogue doctor called it a line that "states the theme
// like a T-shirt" and the rewrite swapped it for "Louder." — faithfully carried
// by the Shot list and spoken by H3. Neither the room nor the Script ever saw
// the prompt, only the World distilled from it, so nothing told them the line
// was not theirs to improve.

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

/** Text reduced for comparison: lower case, letters and digits only. */
const norm = (t) => str(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The prompt → the lines it quotes (double or curly quotes), in order, once each. */
export function authorLines(prompt) {
  const out = [];
  for (const m of String(prompt || "").matchAll(/["“]([^"“”]{1,240})["”]/g)) {
    const line = str(m[1]);
    if (norm(line) && !out.some((l) => norm(l) === norm(line))) out.push(line);
  }
  return out;
}

/** The instruction every story stage carries when the prompt quotes lines ([] → nothing). */
export function authorLinesBrief(lines) {
  if (!lines?.length) return [];
  return [
    "THE AUTHOR'S LINES — the author wrote these words in the prompt, in quotation marks. Each one is",
    "spoken in the film EXACTLY as written, word for word, by the character and at the moment the prompt",
    "gives it. They are not yours to improve, cut, paraphrase or replace, however on the nose they read:",
    ...lines.map((l) => `  "${l}"`),
  ];
}

/** The author's lines no dialogue element of `elements` contains. */
export function missingLines(lines, elements) {
  const spoken = (elements || []).filter((el) => el.type === "dialogue").map((el) => norm(el.text));
  return (lines || []).filter((l) => !spoken.some((s) => s.includes(norm(l))));
}

/** Each dialogue element with its speaker (the character line above it) and its scene number. */
function dialogueOf(elements) {
  const out = [];
  let scene = 0;
  let speaker = "";
  (elements || []).forEach((el, i) => {
    if (el.type === "scene_heading") scene += 1;
    else if (el.type === "character") speaker = norm(str(el.text).replace(/\(.*?\)/g, ""));
    else if (el.type === "dialogue") out.push({ i, scene, speaker, text: el.text });
  });
  return out;
}

/**
 * Put the author's lines a rewrite dropped back into it. For each line, the
 * FIRST draft says who spoke it and in which scene; in the rewrite, that
 * speaker's line in that scene which the first draft does not have is the one
 * the rewrite put in its place, and it gets the original text back.
 * → { elements, restored: [line] } — or null when a dropped line has no one
 * place it clearly goes (the caller then keeps the first draft).
 */
export function restoreLines(lines, before, after) {
  const missing = missingLines(lines, after);
  if (!missing.length) return { elements: after, restored: [] };
  const was = dialogueOf(before);
  const now = dialogueOf(after);
  const old = new Set(was.map((d) => norm(d.text)));
  const elements = after.map((el) => ({ ...el }));
  for (const line of missing) {
    const src = was.find((d) => norm(d.text).includes(norm(line)));
    if (!src) return null;
    const swapped = now.filter((d) => d.scene === src.scene && d.speaker === src.speaker && !old.has(norm(d.text)));
    if (swapped.length !== 1) return null;
    elements[swapped[0].i] = { ...elements[swapped[0].i], text: src.text };
  }
  return { elements, restored: missing };
}
