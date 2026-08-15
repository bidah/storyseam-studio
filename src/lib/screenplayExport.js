// Screenplay export — the inverse of the import path. Import (src/lib/fountain.js
// + notes/schema.js `elementsToDoc`) turns a file into the flat `{ type, text }[]`
// element array; export takes that same array back out to the formats a writer
// expects. Everything runs client-side off the live editor doc — symmetric with
// the client-side Fountain import (no worker route, no agent tool).
//
// Text formats (.fountain, .txt, .fdx) are pure string builders. The two binary
// formats lazy-load their generators so the Script tab's initial bundle stays
// light:
//   .pdf  — jsPDF, laid out in monospace Courier with standard screenplay margins
//   .docx — a minimal OOXML package zipped with fflate
//
// The six element types are the ones the editor speaks:
//   scene_heading | action | character | dialogue | parenthetical | transition

import { docToElements } from "@/components/notes";

// Re-used from src/lib/fountain.js so the round-trip (export → import) is exact.
const SCENE_HEADING = /^(INT|EXT|EST|(I|INT)\.?\/(E|EXT)\.?)[.\-\s]/i;
const TRANSITION_TO = /^[^a-z]*TO:$/;
const TRANSITION_SET = new Set(["FADE OUT.", "CUT TO BLACK.", "FADE TO BLACK."]);

const UPPER_TYPES = new Set(["scene_heading", "character", "transition"]);
const upper = (el) => (UPPER_TYPES.has(el.type) ? el.text.toUpperCase() : el.text);

/* ================================================================ *
 * Fountain (.fountain) — inverse of parseFountain, built to round-trip.
 * ================================================================ */

// One element → its Fountain line. Forced markers ('.', '@', '!', '>') are used
// whenever the plain text would be auto-classified as the WRONG type on re-import
// (e.g. an all-caps action line looks like a character cue), so a file we write
// parses back to the elements we started with.
function toFountainLine(el) {
  const text = el.text;
  switch (el.type) {
    case "scene_heading":
      return SCENE_HEADING.test(text) ? text : `.${text}`;
    case "transition":
      return TRANSITION_TO.test(text) || TRANSITION_SET.has(text) ? text : `> ${text}`;
    case "character":
      return /[a-z]/.test(text) ? `@${text}` : text; // force cue if not all-caps
    case "parenthetical":
      return /^\(.*\)$/.test(text.trim()) ? text : `(${text})`;
    case "dialogue":
      return text;
    case "action":
    default:
      // An all-caps action would re-import as a character cue — force it plain.
      return /[A-Za-z]/.test(text) && !/[a-z]/.test(text) ? `!${text}` : text;
  }
}

export function elementsToFountain(elements, title = "") {
  const blocks = [];
  let dialogue = null; // buffer for a character + its dialogue/parenthetical lines
  const flush = () => {
    if (dialogue) blocks.push(dialogue.join("\n"));
    dialogue = null;
  };
  for (const el of elements) {
    if (el.type === "character") {
      flush();
      dialogue = [toFountainLine(el)];
    } else if ((el.type === "dialogue" || el.type === "parenthetical") && dialogue) {
      // Keep dialogue attached to its cue (no blank line between them).
      dialogue.push(toFountainLine(el));
    } else {
      flush();
      blocks.push(toFountainLine(el));
    }
  }
  flush();
  const header = title ? `Title: ${title}\n\n` : ""; // Fountain title page
  return `${header}${blocks.join("\n\n")}\n`;
}

/* ================================================================ *
 * Plain text (.txt) — a readable, indented transcript (not meant to
 * round-trip; just legible).
 * ================================================================ */

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const indent = (n) => " ".repeat(n);

// [indent chars, wrap width, blank line before] per element type.
const TXT_LAYOUT = {
  scene_heading: [0, 60, true],
  action: [0, 60, true],
  character: [20, 38, true],
  parenthetical: [15, 30, false],
  dialogue: [10, 40, false],
  transition: [40, 30, true],
};

export function elementsToPlainText(elements, title = "") {
  const out = [];
  if (title) out.push(title.toUpperCase(), "", "");
  let atTop = true;
  for (const el of elements) {
    const [pad, width, blankBefore] = TXT_LAYOUT[el.type] || TXT_LAYOUT.action;
    if (blankBefore && !atTop) out.push("");
    for (const l of wrap(upper(el), width)) out.push(indent(pad) + l);
    atTop = false;
  }
  return `${out.join("\n")}\n`;
}

/* ================================================================ *
 * Final Draft (.fdx) — Final Draft's XML container.
 * ================================================================ */

const FDX_TYPE = {
  scene_heading: "Scene Heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
};

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function elementsToFDX(elements, title = "") {
  const paras = elements
    .map((el) => {
      const type = FDX_TYPE[el.type] || "Action";
      return `    <Paragraph Type="${type}">\n      <Text>${xmlEscape(upper(el))}</Text>\n    </Paragraph>`;
    })
    .join("\n");
  const titlePage = title
    ? `\n  <TitlePage>\n    <Content>\n      <Paragraph Alignment="Center"><Text>${xmlEscape(
        title
      )}</Text></Paragraph>\n    </Content>\n  </TitlePage>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<FinalDraft DocumentType="Script" Template="No" Version="5">\n` +
    `  <Content>\n${paras}\n  </Content>${titlePage}\n` +
    `</FinalDraft>\n`
  );
}

/* ================================================================ *
 * PDF (.pdf) — Courier 12pt, US Letter, standard screenplay margins.
 * jsPDF is lazy-loaded (keeps it out of the Script tab's initial bundle).
 * ================================================================ */

const CHAR_W = 12 * 0.6; // Courier is monospace: each glyph is 0.6em → 7.2pt at 12pt
const LINE_H = 14;
const PAGE_TOP = 72; // 1" (jsPDF origin is top-left, y grows downward)
const PAGE_BOTTOM = 720; // 792 (Letter height) − 72

// [x from left edge in pt, wrap width in chars, right-aligned] per element type.
const PDF_LAYOUT = {
  scene_heading: [108, 60, false],
  action: [108, 60, false],
  character: [259, 38, false],
  parenthetical: [220, 34, false],
  dialogue: [180, 40, false],
  transition: [540, 30, true],
};

export async function elementsToPdf(elements, title = "") {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("courier", "normal");
  doc.setFontSize(12);

  let y = PAGE_TOP;
  const newPage = () => {
    doc.addPage();
    y = PAGE_TOP;
  };
  const blank = () => {
    if (y !== PAGE_TOP) y += LINE_H;
  };
  const emit = (text, x, widthChars, rightAlign) => {
    const lines = doc.splitTextToSize(String(text), widthChars * CHAR_W);
    for (const ln of lines) {
      if (y + LINE_H > PAGE_BOTTOM) newPage();
      doc.text(ln, x, y, rightAlign ? { align: "right" } : undefined);
      y += LINE_H;
    }
  };

  if (title) {
    doc.text(title.toUpperCase(), 306, 360, { align: "center" });
    newPage();
  }

  for (const el of elements) {
    const [x, widthChars, rightAlign] = PDF_LAYOUT[el.type] || PDF_LAYOUT.action;
    // Dialogue and parentheticals stay attached to their cue; everything else
    // gets a blank line before it.
    if (el.type !== "dialogue" && el.type !== "parenthetical") blank();
    emit(upper(el), x, widthChars, rightAlign);
  }

  return doc.output("blob");
}

/* ================================================================ *
 * Word (.docx) — a minimal OOXML package zipped with fflate.
 * ================================================================ */

// Left indent (twips; 1440 = 1") from Word's default 1" page margin, plus
// alignment, per element type. Transitions are flush right.
const DOCX_LAYOUT = {
  scene_heading: { left: 720 },
  action: { left: 720 },
  character: { left: 3600 },
  parenthetical: { left: 3024 },
  dialogue: { left: 2160 },
  transition: { jc: "right" },
};

function docxParagraph(el) {
  const cfg = DOCX_LAYOUT[el.type] || DOCX_LAYOUT.action;
  const ind = cfg.left ? `<w:ind w:left="${cfg.left}"/>` : "";
  const jc = cfg.jc ? `<w:jc w:val="${cfg.jc}"/>` : "";
  const rPr = `<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>`;
  // A soft line break (\n inside one element) becomes <w:br/> between text runs.
  const runs = upper(el)
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("<w:br/>");
  return `<w:p><w:pPr>${ind}${jc}</w:pPr><w:r>${rPr}${runs}</w:r></w:p>`;
}

export async function elementsToDocx(elements, title = "") {
  const { zipSync, strToU8 } = await import("fflate");

  const titlePara = title
    ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${xmlEscape(
        title.toUpperCase()
      )}</w:t></w:r></w:p><w:p/>`
    : "";
  const body = elements.map(docxParagraph).join("");
  const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${titlePara}${body}${sectPr}</w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const zipped = zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "word/document.xml": strToU8(documentXml),
    },
    { level: 0 } // "store" — docx opens the same and keeps the writer dependency-free of deflate quirks
  );
  return new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/* ================================================================ *
 * Orchestration + download
 * ================================================================ */

export const EXPORT_FORMATS = [
  { format: "fountain", ext: "fountain", label: "Fountain (.fountain)" },
  { format: "txt", ext: "txt", label: "Plain text (.txt)" },
  { format: "fdx", ext: "fdx", label: "Final Draft (.fdx)" },
  { format: "pdf", ext: "pdf", label: "PDF (.pdf)" },
  { format: "docx", ext: "docx", label: "Word (.docx)" },
];

const EXT = Object.fromEntries(EXPORT_FORMATS.map((f) => [f.format, f.ext]));

const sanitizeFilename = (s) =>
  String(s || "")
    .replace(/[/\\?%*:|"<>]/g, "-") // characters illegal in filenames
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "screenplay";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Serialize the current draft to `format` and trigger a browser download.
 * @param {{ doc: object, title?: string, name?: string, format: string }} args
 * @returns {Promise<{ filename: string, count: number }>} count = elements written
 */
export async function exportScript({ doc, title = "", name = "", format }) {
  if (!EXT[format]) throw new Error(`Unknown export format: ${format}`);
  const elements = docToElements(doc);
  const base = sanitizeFilename(title || name);
  const filename = `${base}.${EXT[format]}`;

  let blob;
  switch (format) {
    case "txt":
      blob = new Blob([elementsToPlainText(elements, title)], { type: "text/plain;charset=utf-8" });
      break;
    case "fountain":
      blob = new Blob([elementsToFountain(elements, title)], { type: "text/plain;charset=utf-8" });
      break;
    case "fdx":
      blob = new Blob([elementsToFDX(elements, title)], { type: "application/xml;charset=utf-8" });
      break;
    case "pdf":
      blob = await elementsToPdf(elements, title);
      break;
    case "docx":
      blob = await elementsToDocx(elements, title);
      break;
    default:
      throw new Error(`Unknown export format: ${format}`);
  }

  downloadBlob(blob, filename);
  return { filename, count: elements.length };
}
