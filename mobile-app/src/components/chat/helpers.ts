import type { AgentMessage, MessagePart, QuestionState } from './types';

// Ports of the web AgentChat.jsx derivations — same semantics, typed.

// Does this part render anything visible in the transcript?
function isVisible(p: MessagePart | undefined): boolean {
  if (!p) return false;
  return (
    (p.type === 'text' && !!p.text?.trim()) ||
    (p.type === 'reasoning' && !!p.text?.trim()) ||
    p.type === 'dynamic-tool' ||
    p.type === 'file'
  );
}

// The agent is "thinking" while a turn is in flight and the current assistant
// message hasn't produced any renderable content yet.
export function isThinking(messages: AgentMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return true;
  return !(last.parts || []).some(isVisible);
}

// The agent is "working" while a turn is in flight and the current assistant
// message's most recent visible content is a tool call with no text after it.
// Returns the trailing tool's name, or null.
export function workingTool(messages: AgentMessage[], busy: boolean): string | null {
  if (!busy) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return null;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'dynamic-tool' ? trailing.toolName || 'tool' : null;
}

// The agent is "reasoning" while a turn is in flight and the current assistant
// message's trailing visible content is a reasoning block. The reasoning panel
// is collapsed and static (it doesn't animate like streaming text), so a
// prolonged chain-of-thought looks like the agent has stalled unless a shimmer
// marker sits below it. Distinct from `isThinking` (nothing rendered yet) and
// `workingTool` (trailing part is a tool call).
export function isReasoning(messages: AgentMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return false;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'reasoning';
}

// The tail of the reasoning the agent is writing RIGHT NOW — the label for the
// shimmer while `isReasoning` holds.
//
// The system prompt tells the agent to open every turn with a plain-text
// acknowledgment before it touches a tool (whistlewood.md "Reply before you
// work"), and the model ignores it: a tap on a card is followed by reasoning and
// tool calls, so the author waits with no idea their answer landed. flue has no
// way to force a text part first, and inventing an acknowledgment the agent
// never wrote would be putting words in its mouth. Its reasoning, however, is
// real and already streaming — so show THAT instead of a generic "Reasoning…".
//
// Last non-empty LINE, not the whole block: reasoning arrives as paragraphs and
// the newest line is the part that reads as progress.
export function reasoningTail(messages: AgentMessage[], busy: boolean): string | null {
  if (!isReasoning(messages, busy)) return null;
  const last = messages[messages.length - 1];
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  const lines = (trailing?.text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

// The agent is actively WRITING: the trailing visible content is a text part
// flue hasn't marked done yet.
//
// This exists to SUPPRESS the progress shimmer. Words appearing on screen are
// already the progress signal, and a "Working…" row pinned under them reads as a
// second, stalled turn running behind the answer — which is exactly how it
// looked. The shimmer is for the gaps (nothing rendered yet, a tool in flight, a
// long silent reasoning block), not for the one moment the agent is visibly
// producing.
//
// A text part with no `state` at all is treated as still streaming: the only
// cost is a missing shimmer for a beat, versus a spinner that contradicts the
// text next to it.
export function isStreamingText(messages: AgentMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return false;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'text' && trailing.state !== 'done';
}

// "Today" / "Yesterday" / "3 days ago" for a timestamp, counted in CALENDAR
// days rather than elapsed hours — which is the whole point of it. A chat
// touched at 11pm and read back at 8am is 9 hours old but it happened
// *yesterday*, and "9h" makes the reader do that subtraction themselves; at the
// wrong hour it quietly lands on the wrong day. So both stamps are floored to
// local midnight first and the difference is a day count.
//
// The ladder stops at a week: past that "13 days ago" is a number nobody
// converts, so it becomes a date — with the year only when it isn't this one,
// since "Jul 12" already reads as this year.
export function dayLabel(ts: number | undefined): string {
  if (!ts) return '';
  const then = new Date(ts);
  const now = new Date();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded, not floored: DST makes one day of the year 23 or 25 hours long, and
  // a bare floor turns that day's "yesterday" into "today".
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000);
  // A clock skew (or a doc written by a device running fast) can date a chat in
  // the future; "Today" is the honest read of that, not "-1 days ago".
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

// Compact "2m" / "3h" / "5d" relative time for the conversations list.
export function relTime(ts: number | undefined): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Plain text of a user message (its text parts joined).
export function userText(message: AgentMessage): string {
  return (message.parts || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}

// A run of assistant prose, split into the markdown around the images and the
// images themselves. See `splitImages`.
export type TextSegment = { md: string; image?: never } | { image: ImageRef; md?: never };
export type ImageRef = { url: string; alt: string };

// `![alt](url)` outside a fenced code block. Non-greedy so two images on one
// line don't swallow the text between them; the alt text may be empty.
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)[^)]*\)/g;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Pull markdown images OUT of a text part so they can be rendered as real
 * pictures instead of 20pt dots.
 *
 * react-native-enriched-markdown decides block-vs-inline by position: an image
 * ALONE in its paragraph gets the 200pt block treatment, an image sharing a
 * paragraph with any text becomes an `inlineImage` — `{ size: 20 }`, a thumbnail
 * the size of a capital letter. The agent writes "**Fulton Street Station** — …
 * warm grain over cold ceramic: ![](…)", which is one paragraph, so four
 * freshly generated location plates rendered as four dots on the baseline.
 *
 * Rather than bet on the model putting every image on its own line, the images
 * are lifted out here and drawn by `ChatImage` (full width, natural aspect,
 * tappable into Galeria) with the markdown around them rendered as before.
 *
 * Fenced code blocks are left alone — an `![…](…)` inside one is sample text,
 * not a picture.
 */
export function splitImages(text: string): TextSegment[] {
  if (!text.includes('![')) return [{ md: text }];
  const segments: TextSegment[] = [];
  let buffer = '';
  let fenced = false;
  const flush = () => {
    if (buffer.trim()) segments.push({ md: buffer.replace(/\n+$/, '') });
    buffer = '';
  };

  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) fenced = !fenced;
    if (fenced || !line.includes('![')) {
      buffer += line + '\n';
      continue;
    }
    let last = 0;
    IMAGE_RE.lastIndex = 0;
    for (let m = IMAGE_RE.exec(line); m; m = IMAGE_RE.exec(line)) {
      buffer += line.slice(last, m.index);
      flush();
      segments.push({ image: { url: m[2].replace(/^<|>$/g, ''), alt: m[1] } });
      last = m.index + m[0].length;
    }
    buffer += line.slice(last) + '\n';
  }
  flush();
  return segments.length ? segments : [{ md: '' }];
}

// The tools whose parts render as an answerable card. `render_ui` is the live
// one; `ask_question` only ever turns up replaying an older conversation.
export const QUESTION_TOOLS = new Set(['render_ui', 'ask_question']);

// A card ENDS the turn, visually. The agent is told so twice — the `render_ui`
// description, the generative-ui skill, and whistlewood.md's "then STOP" — and
// still trails a reasoning block and a paragraph narrating the card it just
// drew ("I've presented the three options — tap one…"). flue exposes no way to
// stop the loop from inside a tool (`AgentRuntimeConfig` has no step hook and a
// tool's `run` can't end the turn), so the last word belongs to whoever renders
// it: everything the model says AFTER the card is dropped here.
//
// Only prose goes — `text` and `reasoning`. A tool part that lands after a card
// stays visible, because hiding real work the agent did would be a lie, not a
// tidy-up.
//
// `sealed` extends that across the MESSAGE boundary. A turn is not one message:
// flue opens a new assistant message per step (`message-started`), so the
// paragraph narrating the card usually lands in the NEXT message and a
// per-message filter never sees it — which is why the trailing "The card is up
// — tap whichever arc you want" survived the first fix. `deriveQA` marks every
// assistant message that follows a card (until the user speaks again) and those
// drop their prose whole.
export function visibleParts<
  T extends { type?: string; toolName?: string; text?: string },
>(parts: T[] | undefined, sealed = false): T[] {
  const list = parts || [];
  let card = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].type === 'dynamic-tool' && QUESTION_TOOLS.has(list[i].toolName ?? '')) card = i;
  }
  if (sealed) return list.filter((p) => !isNarration(p));
  if (card < 0) return list;
  return list.filter((p, i) => i <= card || !isNarration(p));
}

// Prose the card made redundant. A text part carrying a markdown IMAGE is not
// narration whatever else it says — that's a picture the agent generated, and
// dropping it would lose real output, the same way dropping a tool part would.
function isNarration(p: { type?: string; text?: string }): boolean {
  if (p.type === 'reasoning') return true;
  return p.type === 'text' && !(p.text || '').includes('![');
}

// Resolve the answer state of every question card. flue has no server-side
// `inputResponse`, so "answered" is derived from the transcript: a question is
// answered by the first user message after it (its text is the answer); the one
// unanswered question — the last with no user message following — is `pendingId`
// (the only card whose buttons stay live). Port of the web `deriveQA`.
//
// It also collects `sealed`: the ids of the assistant messages drawn AFTER a
// card and before the user's reply. A card is the last word of the turn, and
// the model keeps writing past it into a fresh message — see `visibleParts`.
//
// And `superseded`: cards REPLACED by a later card in the same turn. The model
// sometimes redraws the same question (a card, more reasoning, then a refined
// duplicate of that card in its next step) — two identical asks on screen. The
// LAST card of a turn is the ask; every earlier card with no user message
// between it and the next card is a discarded draft, dropped from rendering.
export function deriveQA(messages: AgentMessage[]): QuestionState {
  const answered = new Map<string, string>();
  const sealed = new Set<string>();
  const superseded = new Set<string>();
  let pendingId: string | null = null;
  let afterCard = false;
  let lastCardId: string | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') {
      afterCard = false;
      lastCardId = null;
      continue;
    }
    if (m.role !== 'assistant') continue;
    if (afterCard && m.id) sealed.add(m.id);
    for (const p of m.parts || []) {
      if (p.type !== 'dynamic-tool' || !QUESTION_TOOLS.has(p.toolName ?? '') || !p.toolCallId)
        continue;
      if (lastCardId) superseded.add(lastCardId);
      lastCardId = p.toolCallId;
      let ans: string | null = null;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'user') {
          ans = userText(messages[j]).trim();
          break;
        }
      }
      if (ans) answered.set(p.toolCallId, ans);
      else pendingId = p.toolCallId;
      afterCard = true;
    }
  }
  return { pendingId, answered, sealed, superseded };
}

// --- Web-search sources -----------------------------------------------------
// The two web tools (`web_search` / `fetch_url`) share one result shape across
// both backends — see flue-agent/src/lib/search-util.ts's `result()`:
//   { provider, query?, count, results: [{ title, url, publishedDate, author,
//     excerpts?, summary?, text? }] }
export const SOURCE_TOOLS = new Set(['web_search', 'fetch_url']);

export type Source = {
  url: string;
  title: string;
  publishedDate: string | null;
  snippet: string;
};

// Pull that payload off a finished tool part. The output arrives as the raw
// object in the normal case, but tolerate a JSON string and the
// `{ content: [{ type: "text", text }] }` envelope so a transport change
// degrades to the plain ToolChip instead of throwing mid-render.
export function parseSourcesOutput(
  part: MessagePart,
): { sources: Source[]; query: string } | null {
  if (part.state !== 'output-available') return null;
  const candidates: unknown[] = [];
  const out = part.output;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    candidates.push(out);
    const content = (out as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const c of content) {
        const t = (c as Record<string, unknown>)?.text;
        if (typeof t === 'string') candidates.push(t);
      }
    }
  } else if (typeof out === 'string') {
    candidates.push(out);
  }
  for (const candidate of candidates) {
    let obj: any = candidate;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        continue;
      }
    }
    const rows = obj?.results;
    if (!Array.isArray(rows)) continue;
    const sources: Source[] = rows
      .filter((r: any) => typeof r?.url === 'string' && r.url)
      .map((r: any) => ({
        url: r.url,
        title: typeof r.title === 'string' && r.title ? r.title : r.url,
        publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : null,
        snippet:
          (Array.isArray(r.excerpts) && typeof r.excerpts[0] === 'string' && r.excerpts[0]) ||
          (typeof r.summary === 'string' && r.summary) ||
          '',
      }));
    if (sources.length) {
      return { sources, query: typeof obj.query === 'string' ? obj.query : '' };
    }
  }
  return null;
}

// Hostname without the www., for the sub-card's secondary line.
export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, '') : url;
}
