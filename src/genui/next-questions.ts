/**
 * The follow-up suggestions shown under a finished turn — "where to go next",
 * the way an AI search engine keeps a conversation moving.
 *
 * This module is the PURE half: when to ask for them, what to send, and how to
 * turn the answer into a card. The fetching and the React state live in each
 * platform's hook, because the two apps authenticate their requests
 * differently (cookies on web, the fetch shim on mobile).
 *
 * The card itself is an openui-lang program rendered by the same `<StudioUI>`
 * as everything else — so a follow-up row looks and behaves exactly like an
 * `OptionList` the agent drew, down to the hairlines and the send-as-next-
 * message channel. No second UI, no second interaction model.
 *
 * This file is CANONICAL and vendored into `mobile-app/src/genui/` by
 * `npm run genui:sync`.
 */

/** One suggestion: what the author taps, and the message it actually sends. */
export interface NextQuestion {
  label: string;
  prompt: string;
}

/** A transcript turn, flattened to what the route needs. */
export interface TurnSummary {
  role: "user" | "assistant";
  text: string;
}

/** Turns sent as context. Matches the route's own cap. */
const MAX_TURNS = 6;

/**
 * Whether a settled thread should offer follow-ups.
 *
 * The rule is "the agent finished and left nothing open": the last message is
 * the assistant's, the turn is done, and there is no unanswered question card —
 * offering "where next?" underneath a question the agent just asked would be
 * two competing sets of buttons and an obvious way to derail the flow.
 */
export function shouldOfferNext({
  hasMessages,
  lastIsAssistant,
  busy,
  pendingQuestion,
}: {
  hasMessages: boolean;
  lastIsAssistant: boolean;
  busy: boolean;
  pendingQuestion: boolean;
}): boolean {
  return hasMessages && lastIsAssistant && !busy && !pendingQuestion;
}

/** Flatten the transcript into the turns the route summarizes. */
export function toTurns(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>,
): TurnSummary[] {
  return messages
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: (m.parts || [])
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("")
        .trim(),
    }))
    .filter((t) => t.text);
}

/**
 * A cache key for a thread's follow-ups. Suggestions belong to the state of the
 * conversation, so they're re-fetched when a new turn lands and NOT when the
 * component happens to re-render — which is what stops a scroll or a theme flip
 * from burning a model call.
 */
export function nextQuestionsKey(messages: Array<{ id?: string }>): string {
  return String(messages[messages.length - 1]?.id ?? messages.length);
}

/** Escape a string for an openui-lang double-quoted literal. */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}

/**
 * Build the card. Each row's `send` is the suggestion's full `prompt` — the
 * composed brief — while the row shows the short `label`, so a tap starts real
 * work instead of making the agent interview its way back to the request. This
 * is the same two-texts-per-card trade `src/lib/suggestions.ts` makes for the
 * landing deck.
 */
export function nextQuestionsProgram(questions: NextQuestion[]): string | null {
  const rows = questions
    .filter((q) => q?.label && q?.prompt)
    .slice(0, 4)
    .map((q, i) => ({
      id: `q${i + 1}`,
      line: `q${i + 1} = Option("${esc(q.label)}", "${esc(q.prompt)}")`,
    }));
  if (!rows.length) return null;
  return [
    "root = Card([next])",
    `next = OptionList([${rows.map((r) => r.id).join(", ")}], "What's next")`,
    ...rows.map((r) => r.line),
  ].join("\n");
}
