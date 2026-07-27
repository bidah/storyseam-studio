// Fountain screenplay parser → the flat `{ type, text }[]` element array the
// Script tab speaks (fed to `elementsToDoc` in src/components/notes/schema.js,
// which turns it into the TipTap `screenplay` nodes the editor renders).
//
// Fountain is a plain-text screenplay markup (https://fountain.io/syntax). The
// parse follows the reference FastFountainParser by Nima Yousefi & John August
// (github.com/nyousefi/Fountain, MIT) — same line-classification order, the same
// "merge consecutive non-blank lines into one element" behavior, and the same
// rule that a scene heading not surrounded by blank lines is demoted to action.
// Adapted to shot-studio's six element types (lyrics/centered fold into action;
// sections, synopses, page breaks, notes and the boneyard are dropped):
//   scene_heading | action | character | dialogue | parenthetical | transition
//
// Pure and dependency-free — the whole parse runs client-side off `file.text()`.
// Emphasis markup is flattened to plain text (the screenplay node carries text,
// not marks) and dual dialogue (`^`) is flattened to sequential blocks.

// A title page exists only when the document opens with one of these keys before
// the first blank line — so a leading "FADE IN:" or "INT." is never mistaken for
// a title directive (the reference parser is looser here and needs a special case
// to undo it; gating on a known key sidesteps that).
const KNOWN_TITLE_KEYS = new Set([
  "title", "credit", "author", "authors", "source", "draft date",
  "date", "contact", "copyright", "notes", "revision",
]);

// Reference regexes (see FastFountainParser.m). Scene/transition/character are
// case-sensitive on the no-lowercase parts by design — that IS the disambiguator.
const SCENE_HEADING = /^(INT|EXT|EST|(I|INT)\.?\/(E|EXT)\.?)[.\-\s]/i;
const TRANSITION_TO = /^[^a-z]*TO:$/;                 // "CUT TO:", "SMASH CUT TO:"
const TRANSITION_SET = new Set(["FADE OUT.", "CUT TO BLACK.", "FADE TO BLACK."]);
const CHARACTER = /^[^a-z]+(\(cont'd\))?$/;           // uppercase cue (+ optional (cont'd))

// Strip Fountain emphasis (*italic*, **bold**, ***both***, _underline_) and
// resolve backslash escapes — the screenplay node holds plain text, no marks.
function plain(s) {
  return String(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/\\([*_\\])/g, "$1")
    .trim();
}

/**
 * Parse a Fountain document.
 * @param {string} src raw .fountain text
 * @returns {{ title: string, elements: {type: string, text: string}[], meta: Record<string,string> }}
 */
export function parseFountain(src) {
  // Normalize newlines and strip the boneyard /* … */ and notes [[ … ]] (both may
  // span lines) up front — we drop them entirely, so no in-loop state is needed.
  const lines = String(src || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "")
    .split("\n");

  const meta = {};
  let i = 0;

  // --- Title page: `Key: Value` (or a bare `Key:` with values on the following
  // indented lines) before the first blank line, only when it opens with a
  // recognized title-page key. ---
  const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
  if (firstNonEmpty !== -1) {
    const m = lines[firstNonEmpty].match(/^([A-Za-z][A-Za-z ]*):/);
    if (m && KNOWN_TITLE_KEYS.has(m[1].trim().toLowerCase())) {
      let key = null;
      for (i = firstNonEmpty; i < lines.length; i++) {
        if (lines[i].trim() === "") { i++; break; }   // blank line ends the title page
        const km = lines[i].match(/^([A-Za-z][A-Za-z ]*):\s?(.*)$/);
        if (km) {
          key = km[1].trim().toLowerCase();
          meta[key] = km[2].trim();
        } else if (key) {
          meta[key] = (meta[key] ? `${meta[key]} ` : "") + lines[i].trim();
        }
      }
    }
  }

  const elements = [];
  const last = () => elements[elements.length - 1];
  const push = (type, text) => elements.push({ type, text });
  // Append a continuation line to the previous element's text (multi-line action
  // or dialogue collapse into one block).
  const mergeIntoLast = (text) => { last().text += `\n${text}`; };

  let newlinesBefore = 1;   // start-of-body counts as preceded by a blank line
  let inDialogue = false;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const c0 = line[0];

    // Forced markers (leading char) — these win over auto-detection.
    if (c0 === "~") { push("action", plain(line.slice(1))); newlinesBefore = 0; continue; }   // lyric → action
    if (c0 === "!") { push("action", plain(line.slice(1))); newlinesBefore = 0; continue; }
    if (c0 === "@") {
      push("character", plain(line.slice(1).replace(/\^\s*$/, "")));
      newlinesBefore = 0; inDialogue = true; continue;
    }

    // Blank line — closes any dialogue block and counts toward "preceded by blank".
    if (line === "") { inDialogue = false; newlinesBefore++; continue; }

    // Dropped structural lines: page break, synopsis, section.
    if (/^={3,}\s*$/.test(line)) { newlinesBefore = 0; continue; }        // page break
    if (c0 === "=") { newlinesBefore = 0; continue; }                     // synopsis (= …)
    if (c0 === "#") { newlinesBefore = 0; continue; }                     // section heading

    // Forced scene heading — a single leading '.' (but not '..').
    if (c0 === "." && line[1] !== ".") {
      push("scene_heading", plain(line.slice(1).replace(/#([^\n#]*?)#\s*$/, ""))); // drop scene number
      newlinesBefore = 0; continue;
    }

    // Scene heading — must be preceded by a blank line.
    if (newlinesBefore > 0 && SCENE_HEADING.test(line)) {
      push("scene_heading", plain(line.replace(/#([^\n#]*?)#\s*$/, "")));
      newlinesBefore = 0; continue;
    }

    // Transitions — "… TO:" or a known FADE/CUT form (no preceding-blank needed).
    if (TRANSITION_TO.test(line) || TRANSITION_SET.has(line)) {
      push("transition", plain(line)); newlinesBefore = 0; continue;
    }
    // Forced transition / centered text via '>'.
    if (c0 === ">") {
      const m = /^>(.*)<$/.exec(line);
      if (m) push("action", plain(m[1]));           // >centered< has no element type here
      else push("transition", plain(line.slice(1)));
      newlinesBefore = 0; continue;
    }

    // Character cue — uppercase, preceded by a blank, with a non-blank line after.
    if (newlinesBefore > 0 && CHARACTER.test(line) && /[A-Za-z]/.test(line) && lines[i + 1]?.trim()) {
      push("character", plain(line.replace(/\s*\^\s*$/, "")));
      newlinesBefore = 0; inDialogue = true; continue;
    }

    // Inside a dialogue block: parentheticals and (merging) dialogue.
    if (inDialogue) {
      if (newlinesBefore === 0 && /^\(/.test(line)) push("parenthetical", plain(line));
      else if (last()?.type === "dialogue") mergeIntoLast(plain(line));
      else push("dialogue", plain(line));
      newlinesBefore = 0; continue;
    }

    // A non-blank line right after another (no blank between) continues the
    // previous element — and a scene heading that isn't blank-surrounded is
    // demoted to action, per the reference parser.
    if (newlinesBefore === 0 && elements.length) {
      if (last().type === "scene_heading") last().type = "action";
      mergeIntoLast(plain(line));
      continue;
    }

    push("action", plain(line));
    newlinesBefore = 0;
  }

  // Drop any element that reduced to empty text (e.g. a bare "!" or ">").
  const cleaned = elements.filter((el) => el.text.trim() !== "");
  return { title: meta.title || "", elements: cleaned, meta };
}
