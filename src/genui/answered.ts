/**
 * Which choice on a card the author actually took.
 *
 * A card's answer isn't stored anywhere: flue can't suspend a turn, so tapping a
 * component posts its `send` string as the next user message and `deriveQA`
 * reads the answer back off the transcript. That string is the ONLY record of
 * the pick — so matching it against each component's `send` is what turns "this
 * card is dead" into "this is the option you chose". Without it an answered
 * card just greys out uniformly, which reads as "expired", not as "picked".
 *
 * Two message shapes have to match, because two shapes are sent:
 *   · single-select — the message IS the component's `send`, verbatim.
 *   · several questions — a card with two or more single-select lists sends
 *     one picked `send` per line (see `ask-form.ts`).
 *   · multi-select  — the list composes `"<list send>: <pick>, <pick>"` (see
 *     `useMultiSelect` in the renderers), so the head matches the list itself
 *     and each comma-separated tail segment matches one picked child.
 *
 * Comparison is trimmed and case-insensitive and nothing else is inferred: a
 * typed reply that merely resembles an option leaves the card unmarked rather
 * than lighting up a choice the author never made.
 */
import { createContext, useContext } from "react";

/**
 * The reply that answered the card currently rendering — `null` while it's
 * still live (or when it was never a question). Provided by `StudioUI`.
 */
export const AnsweredContext = createContext<string | null>(null);

/** Does `answer` name `send` — as the whole reply, or as one pick within it? */
export function matchesAnswer(answer: string | null | undefined, send?: string | null): boolean {
  if (!answer || !send) return false;
  const a = answer.trim().toLowerCase();
  const s = send.trim().toLowerCase();
  if (!s) return false;
  if (a === s) return true;
  // A card asking several questions answers them one per line (ask-form.ts).
  if (a.includes("\n")) return a.split("\n").some((line) => matchesAnswer(line, send));
  const colon = a.indexOf(":");
  if (colon < 0) return false;
  if (a.slice(0, colon).trim() === s) return true;
  return a
    .slice(colon + 1)
    .split(",")
    .some((pick) => pick.trim() === s);
}

/**
 * How one `send`-carrying element should render on a card that's been answered:
 * `picked` is the choice that was taken, `dimmed` is every sibling it was taken
 * over. Both are false while the card is live, so a renderer can apply them
 * unconditionally.
 *
 * An element with NO `send` never dims. It was never a choice, so "passed over"
 * says nothing true about it — and the elements that lack one are exactly the
 * display-only media a card exists to show: the picture the agent just
 * generated, a listen-only take. Greying those out the moment the author types
 * again would fade the output itself into history.
 */
export function useAnswerState(send?: string | null): { picked: boolean; dimmed: boolean } {
  const answer = useContext(AnsweredContext);
  const picked = matchesAnswer(answer, send);
  return { picked, dimmed: !!answer && !!send && !picked };
}
