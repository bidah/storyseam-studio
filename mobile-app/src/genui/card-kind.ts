// GENERATED — DO NOT EDIT.
// Vendored from src/genui/card-kind.ts by `npm run genui:sync`. Edit the
// canonical file there and re-run the sync; changes made here are overwritten.

/**
 * Tell a `render_ui` card that ASKS from one that SHOWS — and decide when a
 * later card may replace an earlier one.
 *
 * The chat drops earlier cards of the same turn (`superseded` in `deriveQA`):
 * the model sometimes redraws a question — a card, more reasoning, then a
 * refined duplicate — and two copies of one ask on screen is worse than one.
 * That rule was written when every card was a question. It is not: a `MediaGrid`
 * of a finished generation and an `AudioList` of a finished take are cards the
 * agent draws to HAND BACK OUTPUT, and the pipeline produces those in runs —
 * "make me two concept images" is two generations, each attached and shown as
 * it lands. Blind superseding threw the first picture away, so an author who
 * asked for two images watched two render and got one card. That is the bug
 * this file exists to prevent.
 *
 * So the questions here are textual, asked of the program the model wrote:
 *
 *   · `isShowcaseCard` — does this card only SHOW a result (media blocks, and
 *     nothing to tap)? Such a card is output, not a question: it never goes
 *     pending, and it never seals the prose that follows it, because the agent
 *     is mid-run and its next sentence is about the next image.
 *   · `supersedes` — may this later card stand in for that earlier one? Only if
 *     it still shows every picture and clip the earlier one did. A redraw of the
 *     same card (the usual case) contains all of them and wins; a card showing
 *     the SECOND image does not, and both stay.
 *
 * Textual, not parsed, for the same reason `ensure-confirm.ts` is: this runs on
 * the raw `input.lang` of a tool part in a list render, on web and on React
 * Native, long before (and regardless of whether) the renderer parses it.
 * Detection is deliberately biased toward "this is an ask": a false showcase
 * would leave a real question inert, while a false ask only costs a superseded
 * card the redraw it would have had anyway.
 *
 * This file is CANONICAL and vendored into `mobile-app/src/genui/` by
 * `npm run genui:sync`.
 */

/** Blocks that exist to show a finished result. */
const SHOWCASE_BLOCKS = ["MediaGrid", "MediaItem", "AudioList", "AudioItem"];

/**
 * Components a tap answers through. Same list as `ensure-confirm.ts` — every
 * one of them either carries a `send` of its own or (Chips) is implicitly
 * tappable, so a card containing one is a question however much else it shows.
 */
const TAPPABLE_BLOCKS = [
  "Action",
  "Actions",
  "Option",
  "OptionList",
  "Chips",
  "Recommendation",
  "Plugin",
  "PluginList",
];

/** The two row components whose `send` is optional — the ones that can be display-only. */
const MEDIA_ROWS = ["MediaItem", "AudioItem"];

/**
 * `send` is the THIRD positional argument of both `MediaItem(src, display,
 * send, …)` and `AudioItem(src, title, send, …)`. Arguments are positional by
 * contract, so an index is all this needs.
 */
const SEND_ARG = 2;

/** Blank out every double-quoted literal so a value like "Action stations" can't read as a component. */
function stripStrings(program: string): string {
  return program.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** True when `name(` appears as a component call (outside any string). */
function usesComponent(stripped: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(stripped);
}

/** One component call found in the program, with its arguments as raw source. */
interface Call {
  name: string;
  args: string[];
}

/**
 * Read the argument list that starts just after a `(`, returning each top-level
 * argument as written. Depth and string state are tracked so a comma inside a
 * nested array or a quoted caption doesn't split an argument in two.
 */
function readArgs(program: string, start: number): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < program.length; i++) {
    const ch = program[i];
    if (inStr) {
      current += ch;
      if (ch === "\\") current += program[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" && depth === 0) break;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Every call of the named components anywhere in the program — including ones
 * nested inside another call's arguments, since the scan never skips over an
 * argument list it has already read.
 */
function scanCalls(program: string, names: string[]): Call[] {
  const wanted = new Set(names);
  const out: Call[] = [];
  let ident = "";
  let inStr = false;
  for (let i = 0; i < program.length; i++) {
    const ch = program[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      ident = "";
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) {
      ident += ch;
      continue;
    }
    if (ch === "(") {
      if (wanted.has(ident)) out.push({ name: ident, args: readArgs(program, i + 1) });
      ident = "";
      continue;
    }
    // Whitespace between the name and its `(` is legal; anything else ends the
    // identifier without opening a call.
    if (!/\s/.test(ch)) ident = "";
  }
  return out;
}

/** The text of a `"…"` literal argument, or null when the argument is anything else. */
function literal(arg: string | undefined): string | null {
  if (!arg) return null;
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(arg.trim());
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

/** True when an argument holds SOMETHING — anything but omitted, empty or `null`. */
function present(arg: string | undefined): boolean {
  const text = (arg ?? "").trim();
  return !!text && text !== "null" && text !== '""';
}

/**
 * The media a card puts on screen: the `src` of every `MediaItem` / `AudioItem`
 * it contains. This is the card's OUTPUT — what is lost if the card is dropped
 * — which is exactly what `supersedes` needs to weigh.
 */
export function cardMedia(program: string | null | undefined): string[] {
  const text = (program ?? "").trim();
  if (!text) return [];
  const urls = new Set<string>();
  for (const call of scanCalls(text, MEDIA_ROWS)) {
    const src = literal(call.args[0]);
    if (src) urls.add(src);
  }
  return [...urls];
}

/**
 * True when this card only SHOWS a finished result — media blocks, nothing to
 * tap. Everything else counts as an ask, including a card with no recognisable
 * blocks at all: a question wrongly read as a showcase goes inert, which is the
 * one failure worth avoiding here. (A params-only dead end is an ask too — it
 * gets its confirm spliced in at render time by `ensure-confirm.ts`.)
 */
export function isShowcaseCard(program: string | null | undefined): boolean {
  const text = (program ?? "").trim();
  if (!text) return false;
  const stripped = stripStrings(text);
  if (!SHOWCASE_BLOCKS.some((name) => usesComponent(stripped, name))) return false;
  if (TAPPABLE_BLOCKS.some((name) => usesComponent(stripped, name))) return false;
  // A media row given a `send` is a pick, not a display — one is enough to make
  // the whole card a question.
  return !scanCalls(text, MEDIA_ROWS).some((call) => present(call.args[SEND_ARG]));
}

/**
 * May `next` replace `prev` on screen — i.e. is `prev` a discarded draft rather
 * than output of its own?
 *
 * A card holding no media is judged the way it always was: the later card is the
 * ask, the earlier one is the draft. A card holding media survives unless the
 * later card shows every piece of it, because that is the difference between the
 * model redrawing one card and the agent handing back a second picture.
 */
export function supersedes(
  prev: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const shown = cardMedia(prev);
  if (!shown.length) return true;
  const kept = new Set(cardMedia(next));
  return shown.every((src) => kept.has(src));
}
