// GENERATED — DO NOT EDIT.
// Vendored from src/genui/ensure-confirm.ts by `npm run genui:sync`. Edit the
// canonical file there and re-run the sync; changes made here are overwritten.

/**
 * Guarantee a confirm/param card can be answered with a TAP.
 *
 * The agent is told — by `render_ui`'s description and the generative-ui /
 * destructive-approval skills — that a card built around params (a `KeyValue`
 * or `Compare` of what it is about to submit) MUST ship an `Actions` block in
 * the SAME program, because its turn ends at `render_ui`: a buttonless card
 * leaves the author with nothing to tap but the literal word "confirm". The
 * worker's `render_ui` guard (flue-agent/src/tools/render_ui.ts) catches the
 * omission and hands the model a correction — but the CLIENT renders the tool
 * call's `input.lang` DIRECTLY, so the buttonless card is shown to the author
 * anyway (and a shaky model may never redraw it right). Seen in the wild on a
 * "second take" storyboard-still confirmation.
 *
 * This is the net for that: if a program states terms with nothing to answer
 * them, synthesize the go-ahead the agent forgot. It runs on every program on
 * its way into `<StudioUI>`, so a rescued confirm is indistinguishable from one
 * the model drew on purpose — same rows, same buttons, same send-as-next-message
 * channel. Same spirit as detect-options.ts; nothing here is a second UI.
 *
 * The heuristic is the worker guard's, kept deliberately narrow so it never
 * touches a card that is already answerable or is legitimately tap-free (a
 * finished MediaGrid, an AudioList of takes): a program is only rescued when it
 * contains a PARAM block, no result-SHOWCASE block, and nothing tappable.
 *
 * This file is CANONICAL and vendored into `mobile-app/src/genui/` by
 * `npm run genui:sync`.
 */

/** Blocks that state the terms of a decision — they need an answer beside them. */
const PARAM_BLOCKS = ["KeyValue", "Compare"];

/** Result-showcase blocks — a card built around these is legitimately tap-free. */
const SHOWCASE_BLOCKS = ["MediaGrid", "MediaItem", "AudioList", "AudioItem"];

/** Components a tap answers through — their presence means the card isn't stranded. */
const TAPPABLE_BLOCKS = [
  "Action",
  "Actions",
  "Option",
  "OptionList",
  "Chips",
  "Recommendation",
];

/** The statements we splice in. Double-underscored so they can't collide with a model name. */
const OK = "__confirmActions";
const YES = "__confirmYes";
const EDIT = "__confirmEdit";
const BODY = "__confirmBody";
const INJECTED = [OK, YES, EDIT, BODY];

/** The go-ahead we append: a primary confirm plus an escape hatch, both in the author's voice. */
const ACTIONS_STATEMENTS = [
  `${OK} = Actions([${YES}, ${EDIT}])`,
  `${YES} = Action("Confirm", "Yes — go ahead", "primary")`,
  `${EDIT} = Action("Change something first", "Wait — let me change something first")`,
];

/** Blank out every double-quoted literal so a value like "Call to Action" can't read as a component. */
function stripStrings(program: string): string {
  return program.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** True when `name(` appears as a component call (outside any string). */
function usesComponent(stripped: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(stripped);
}

/** Split the program into `{ name, rhs, line }` statements; non-statement lines are skipped. */
interface Statement {
  name: string;
  rhs: string;
  index: number;
}
function statements(lines: string[]): Statement[] {
  const out: Statement[] = [];
  lines.forEach((line, index) => {
    const m = /^\s*([A-Za-z_][\w-]*)\s*=\s*(.*\S)\s*$/.exec(line);
    if (m) out.push({ name: m[1], rhs: m[2], index });
  });
  return out;
}

/**
 * Index of the `]` that closes the first `[...]` array argument of a `Card(` on
 * this line, or -1. Tracks bracket depth and skips brackets inside strings, so a
 * `"[bracketed]"` value in a KeyValue row can't throw the count off.
 */
function cardArrayClose(line: string): number {
  const card = /\bCard\s*\(/.exec(line);
  if (!card) return -1;
  const open = line.indexOf("[", card.index + card[0].length);
  if (open < 0) return -1;
  let depth = 0;
  let inStr = false;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Add a go-ahead to a `render_ui` program that states terms with no way to
 * answer them. Returns the program unchanged when it's already answerable, is a
 * finished result, isn't a param card at all, or is too unusual to touch safely.
 */
export function ensureConfirm(program: string | null | undefined): string {
  const text = (program ?? "").trim();
  if (!text) return text;

  const stripped = stripStrings(text);
  const has = (names: string[]) => names.some((n) => usesComponent(stripped, n));

  // The worker guard's rule, verbatim: rescue ONLY a card that states terms,
  // shows no result, and offers nothing to tap.
  const deadEnd = has(PARAM_BLOCKS) && !has(SHOWCASE_BLOCKS) && !has(TAPPABLE_BLOCKS);
  if (!deadEnd) return text;

  const lines = text.split("\n");
  const stmts = statements(lines);
  const root = stmts.find((s) => s.name === "root");
  if (!root) return text;

  // Our splice names must be free — a model that already used one is reason
  // enough to leave the whole program alone rather than clobber it.
  const taken = new Set(stmts.map((s) => s.name));
  if (INJECTED.some((n) => taken.has(n))) return text;

  // Resolve what `root` renders: `Card([...])` inline, or a bare identifier
  // pointing at the statement that is one. Anything else falls through to wrap.
  const target =
    cardArrayClose(lines[root.index]) >= 0
      ? root
      : stmts.find((s) => s.name === root.rhs && cardArrayClose(lines[s.index]) >= 0);

  if (target) {
    // Append the Actions to the existing Card's children array.
    const line = lines[target.index];
    const close = cardArrayClose(line);
    const inner = line.slice(line.indexOf("[", line.search(/\bCard\s*\(/)) + 1, close).trim();
    const insert = inner ? `, ${OK}` : OK;
    lines[target.index] = `${line.slice(0, close)}${insert}${line.slice(close)}`;
    return [...lines, ...ACTIONS_STATEMENTS].join("\n");
  }

  // No Card to append to (root is a Section/KeyValue/Compare directly, or an
  // indirection we don't follow): wrap the whole thing in one.
  lines[root.index] = lines[root.index].replace(
    /^(\s*root\s*=\s*)(.*)$/,
    (_m, lead: string, rhs: string) => `${lead}Card([${BODY}, ${OK}])\n${BODY} = ${rhs}`,
  );
  return [...lines, ...ACTIONS_STATEMENTS].join("\n");
}
