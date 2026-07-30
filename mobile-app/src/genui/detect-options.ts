// GENERATED — DO NOT EDIT.
// Vendored from src/genui/detect-options.ts by `npm run genui:sync`. Edit the
// canonical file there and re-run the sync; changes made here are overwritten.

/**
 * Turn an enumerated choice list the agent wrote in PROSE into a real card.
 *
 * The agent is told to draw choices with `render_ui` (see the generative-ui
 * skill), but models fall back to plain markdown constantly — "A) Seedance
 * B) Veo C) Wait for the stem" at the end of a message. This is the safety net
 * for those: detect that trailing list, strip it out of the markdown, and
 * synthesize the openui-lang program the agent should have written.
 *
 * The output goes through the SAME `<StudioUI>` renderer as a genuine
 * `render_ui` part, so a rescued list is indistinguishable from one the model
 * drew on purpose — same rows, same hairlines, same send-as-next-message
 * channel. Nothing here is a second UI implementation.
 *
 * This file is CANONICAL and vendored into `mobile-app/src/genui/` by
 * `npm run genui:sync`.
 *
 * ## Why the heuristics are this strict
 *
 * A false positive is much worse than a miss: it turns an explanatory numbered
 * list ("1. Pull the shot list 2. Break scene 2 into beats") into buttons that
 * post nonsense as the user. So a list is only rescued when EVERY one of these
 * holds — see `detectOptions` for the checks in order.
 */

/** A choice list found at the end of a message. */
export interface DetectedOptions {
  /** The message text with the list removed — what still renders as markdown. */
  body: string;
  /** The synthesized openui-lang program for the list. */
  program: string;
  /** How many choices were found (callers log/telemeter this). */
  count: number;
}

/** `A)` / `A.` / `1)` / `1.` — the markers models actually use for choices. */
const ITEM = /^\s{0,3}(?:([A-Ha-h])|(\d{1,2}))[).]\s+(\S.*)$/;

/**
 * Cue words that make a preceding paragraph read as "…so pick one".
 *
 * Deliberately excludes a bare "or": it's far too common in ordinary prose
 * ("Sara or Helena", "two or three shots") and a genuine either/or question
 * almost always carries a "?" or one of these words anyway.
 */
const CUE =
  /\b(option|options|choose|choosing|choice|choices|pick|prefer|which|whichever|want me to|would you like|should i|shall i|do you want|go with|either|alternatively)\b/i;

/** Splits an item into its bold lead-in and the rest. */
const SPLIT = /\s+(?:—|–|-{1,2}|:)\s+/;

const MIN_ITEMS = 2;
const MAX_ITEMS = 6;
/** Longer than this and it's prose that happens to be numbered, not a choice. */
const MAX_ITEM_CHARS = 160;
/** How much of the lead-in to search for a cue word. */
const CUE_WINDOW = 260;
/** A closer is one or two short lines, not another paragraph of reasoning. */
const MAX_CLOSER_LINES = 2;
const MAX_CLOSER_CHARS = 140;

/** Escape a string for an openui-lang double-quoted literal. */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip the markdown a model puts in a choice label (`**bold**`, `` `code` ``). */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\([^)]*\)/g, "$1")
    .trim()
    .replace(/[.,;:]$/, "");
}

/**
 * Find a trailing enumerated choice list. Returns null unless it is confident —
 * which is most of the time, by design.
 */
export function detectOptions(text: string | null | undefined): DetectedOptions | null {
  if (!text) return null;
  // A fenced block anywhere means code/markup is in play; the line scanner
  // below can't tell a code comment from a list item, so don't try.
  if (text.includes("```")) return null;

  const all = text.replace(/\s+$/, "").split("\n");

  // 0. Peel off a trailing CLOSER — the question models like to put BELOW the
  //    list ("Which direction, or shall I do all three?"). Without this the
  //    backwards scan in 1 hits a non-item line straight away and skips the
  //    whole message, which is how a real three-way choice shipped as prose.
  //
  //    A closer has to be short AND read as "so pick one": it must ask (`?`)
  //    and carry a selection cue. Both, because either alone lets a plan recap
  //    through — "…3. Ship it.\n\nSound good?" asks but offers no choice, and
  //    "…3. Ship it.\n\nRunning it now, which takes a minute." says "which"
  //    without asking anything.
  let lastItem = -1;
  for (let n = all.length - 1; n >= 0; n--) {
    if (ITEM.test(all[n])) {
      lastItem = n;
      break;
    }
  }
  if (lastItem < 0) return null;
  const closer = all.slice(lastItem + 1).filter((l) => l.trim());
  if (closer.length) {
    if (closer.length > MAX_CLOSER_LINES) return null;
    const joined = closer.join(" ");
    if (joined.length > MAX_CLOSER_CHARS) return null;
    if (!joined.includes("?") || !CUE.test(joined)) return null;
  }
  const lines = all.slice(0, lastItem + 1);

  // 1. Walk backwards over the trailing block of item lines. Blank lines
  //    between items are fine (models double-space lists); anything else ends
  //    the block, so only a list at the very END of the message qualifies.
  const items: Array<{ marker: string; numeric: boolean; text: string }> = [];
  let i = lines.length - 1;
  for (; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) {
      // Only skip a blank if we're between items, not before we've found any.
      if (items.length) continue;
      return null;
    }
    const m = ITEM.exec(line);
    if (!m) break;
    items.unshift({ marker: (m[1] ?? m[2]).toUpperCase(), numeric: !!m[2], text: m[3] });
    if (items.length > MAX_ITEMS) return null;
  }
  if (items.length < MIN_ITEMS) return null;

  // 2. Markers must run in sequence from the top (A,B,C… / 1,2,3…). Guards
  //    against a stray "2011) …" or a re-started list.
  const numeric = items[0].numeric;
  if (items.some((it) => it.numeric !== numeric)) return null;
  const first = numeric ? Number(items[0].marker) : items[0].marker.charCodeAt(0);
  if (numeric && first !== 1) return null;
  if (!numeric && items[0].marker !== "A") return null;
  for (let n = 0; n < items.length; n++) {
    const got = numeric ? Number(items[n].marker) : items[n].marker.charCodeAt(0);
    if (got !== first + n) return null;
  }

  // 3. Items must look like choices, not paragraphs or media.
  if (items.some((it) => it.text.length > MAX_ITEM_CHARS)) return null;
  if (items.some((it) => it.text.includes("!["))) return null;

  // 4. The prose must actually be asking. Without this every "here's what I
  //    did: 1. … 2. …" recap would sprout buttons. A qualified closer IS that
  //    question, so it stands in for the lead-in when there is one.
  const above = lines.slice(0, i + 1).join("\n").replace(/\s+$/, "");
  if (!closer.length) {
    const leadIn = above.slice(-CUE_WINDOW);
    if (!leadIn.trim()) return null;
    if (!leadIn.includes("?") && !CUE.test(leadIn)) return null;
  }
  // The closer keeps rendering as markdown above the card — it's the question
  // the rows answer, so dropping it would leave them with no context.
  const body = [above, closer.join("\n")].filter((s) => s.trim()).join("\n\n");
  if (!body.trim()) return null;

  // 5. Build the program. Each row's `send` is its title — the shortest thing
  //    that reads naturally as the author speaking ("Render it with Seedance").
  const rows = items.map((it, n) => {
    const whole = plain(it.text);
    const cut = whole.split(SPLIT);
    const title = plain(cut[0] || whole);
    const subtitle = cut.length > 1 ? plain(cut.slice(1).join(" — ")) : "";
    const args = [`"${esc(title)}"`, `"${esc(title)}"`];
    if (subtitle) args.push(`"${esc(subtitle)}"`);
    return { id: `o${n + 1}`, line: `o${n + 1} = Option(${args.join(", ")})` };
  });

  const program = [
    "root = Card([opts])",
    `opts = OptionList([${rows.map((r) => r.id).join(", ")}], null, "Or just tell me what you'd rather do.")`,
    ...rows.map((r) => r.line),
  ].join("\n");

  return { body, program, count: items.length };
}
